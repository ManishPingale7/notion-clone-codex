import express from 'express';
import { createServer } from 'node:http';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { Server } from 'socket.io';
import sanitize from './sanitize.generated.cjs';
import { resolve } from 'node:path';
import { db, get, all, run, uid, now, transaction, createWorkspace, insertPage } from './db.js';
import { allowedOrigin } from './origins.js';
const app = express();
const http = createServer(app);
const io = new Server(http, {
  maxHttpBufferSize: 100000,
  allowRequest: (req, callback) =>
    callback(
      null,
      allowedOrigin(req.headers.origin, req.headers.host, req.socket.encrypted ? 'https' : 'http'),
    ),
});
if (process.env.VERCEL) app.set('trust proxy', 1);
else if (process.env.TRUST_PROXY === 'loopback') app.set('trust proxy', 'loopback');
app.disable('x-powered-by');
app.use(
  express.json({
    limit: '2mb',
  }),
);
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  res.set('X-Frame-Options', 'DENY');
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
  if (
    !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
    req.headers.origin &&
    !allowedOrigin(req.headers.origin, req.get('host'), req.protocol)
  )
    return res.status(403).json({
      error: 'Cross-origin requests are not allowed',
    });
  next();
});
const fail = (status, message) => {
  const e = new Error(message);
  e.status = status;
  throw e;
};
const text = (v, max = 200) =>
  typeof v === 'string' && v.length <= max ? v : fail(400, 'Invalid text or too long');
const clean = (v) =>
  sanitize(text(v, 100000), {
    allowedTags: ['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'code', 'a', 'br', 'span', 'mark'],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      span: ['style'],
      mark: ['style'],
    },
    allowedStyles: {
      '*': {
        color: [/^#[0-9a-f]{3,6}$/i],
        'background-color': [/^#[0-9a-f]{3,6}$/i],
      },
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: sanitize.simpleTransform('a', {
        rel: 'noopener noreferrer',
        target: '_blank',
      }),
    },
  });
const hash = (token) => createHash('sha256').update(token).digest('hex');
async function userForCookie(cookie = '') {
  const token = cookie
    .split(';')
    .map((x) => x.trim())
    .find((x) => x.startsWith('session='))
    ?.slice(8);
  return (
    token &&
    (await get(
      'SELECT users.id,users.name,users.email FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>?',
      hash(token),
      Date.now(),
    ))
  );
}
async function session(res, user) {
  const token = randomBytes(32).toString('hex');
  await run(
    'INSERT INTO sessions VALUES (?,?,?)',
    hash(token),
    user.id,
    Date.now() + 30 * 86400000,
  );
  res.cookie('session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === '1' || !!process.env.VERCEL,
    maxAge: 30 * 86400000,
    path: '/',
  });
}
const attempts = new Map();
function throttle(req, res, next) {
  const key = req.ip;
  const entry = attempts.get(key);
  if (entry && entry.until > Date.now() && entry.count >= 40)
    return res.status(429).json({
      error: 'Too many attempts. Try again in 15 minutes.',
    });
  attempts.set(
    key,
    entry && entry.until > Date.now()
      ? {
          ...entry,
          count: entry.count + 1,
        }
      : {
          count: 1,
          until: Date.now() + 900000,
        },
  );
  next();
}
app.post('/api/auth/register', throttle, async (req, res) => {
  const email = text(req.body.email).trim().toLowerCase(),
    name = text(req.body.name, 80).trim(),
    password = text(req.body.password, 200);
  if (!/^\S+@\S+\.\S+$/.test(email) || !name || password.length < 8)
    fail(400, 'Use a valid email, a name, and at least 8 password characters.');
  if (await get('SELECT id FROM users WHERE email=?', email))
    fail(409, 'An account with this email already exists.');
  const salt = randomBytes(16).toString('hex'),
    user = {
      id: uid(),
      email,
      name,
    };
  await transaction(async () => {
    await run(
      'INSERT INTO users VALUES (?,?,?,?,?)',
      user.id,
      email,
      name,
      `${salt}:${scryptSync(password, salt, 64).toString('hex')}`,
      now(),
    );
    const workspace = await createWorkspace(user, `${name.split(' ')[0]}'s workspace`);
    const page = await insertPage(user, workspace, {
      title: 'Getting started',
      icon: '👋',
    });
    await run('DELETE FROM blocks WHERE page_id=?', page);
    const blocks = [
      ['heading1', 'Your ideas, all in one place.'],
      ['text', 'Welcome to your workspace. A place to think, write, and make things happen.'],
      ['callout', 'Make this space your own. Click anywhere and start typing.'],
      ['heading2', 'A few things to try'],
      ['todo', 'Give this page a new title'],
      ['todo', 'Type / on a new line to explore blocks'],
      ['todo', 'Create a page using + in the sidebar'],
      ['todo', 'Invite a collaborator from the Share menu'],
      ['divider', ''],
      [
        'text',
        'Everything you write is saved automatically. Your pages are private until you choose to share them.',
      ],
    ];
    await asyncEach(
      blocks,
      async ([type, html], i) =>
        await run(
          'INSERT INTO blocks (id,page_id,type,html,position) VALUES (?,?,?,?,?)',
          uid(),
          page,
          type,
          html,
          i,
        ),
    );
  });
  await session(res, user);
  res.status(201).json(user);
});
app.post('/api/auth/login', throttle, async (req, res) => {
  const user = await get(
    'SELECT * FROM users WHERE email=?',
    text(req.body.email).trim().toLowerCase(),
  );
  const password = text(req.body.password, 200);
  const [salt, key] = (user?.password || 'invalid:' + '00'.repeat(64)).split(':');
  if (!timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(key, 'hex')) || !user)
    fail(401, 'Email or password is incorrect.');
  await session(res, user);
  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
  });
});
app.post('/api/auth/logout', async (req, res) => {
  const token = req.headers.cookie
    ?.split(';')
    .map((x) => x.trim())
    .find((x) => x.startsWith('session='))
    ?.slice(8);
  if (token) await run('DELETE FROM sessions WHERE token=?', hash(token));
  res.clearCookie('session', {
    path: '/',
  });
  res.json({
    ok: true,
  });
});
app.get('/api/public/:token', async (req, res) => {
  const root = await get('SELECT * FROM pages WHERE public_token=?', req.params.token);
  if (!root) fail(404, 'This link is no longer available.');
  let cursor = root;
  while (cursor) {
    if (cursor.deleted) fail(404, 'This page is in the trash.');
    cursor = cursor.parent_id
      ? await get('SELECT * FROM pages WHERE id=?', cursor.parent_id)
      : null;
  }
  const records = [];
  async function collect(p) {
    records.push({
      id: p.id,
      parent_id: p.parent_id,
      title: p.title,
      icon: p.icon,
      cover: p.cover,
      kind: p.kind,
      full_width: p.full_width,
      properties: JSON.parse(p.properties),
      config: JSON.parse(p.config),
      blocks: await blocks(p.id),
    });
    for (const child of await all(
      'SELECT * FROM pages WHERE parent_id=? AND deleted=0 ORDER BY position',
      p.id,
    ))
      await collect(child);
  }
  await collect(root);
  res.json({
    root: root.id,
    pages: records,
  });
});
app.use('/api', async (req, res, next) => {
  req.user = await userForCookie(req.headers.cookie);
  if (!req.user)
    return res.status(401).json({
      error: 'Please sign in.',
    });
  next();
});
app.get('/api/me', (req, res) => res.json(req.user));
app.post('/api/sync', async (req, res) => {
  const connection = text(req.body.connection, 100);
  if (!/^[a-zA-Z0-9-]{16,100}$/.test(connection)) fail(400, 'Invalid presence connection');
  const pageId = typeof req.body.page === 'string' ? text(req.body.page, 100) : null;
  const page =
    pageId && pageId !== 'home' ? await get('SELECT * FROM pages WHERE id=?', pageId) : null;
  const access = await permission(req.user, page);
  if (access)
    await run(
      'INSERT INTO presence (connection_id,user_id,page_id,updated_at) VALUES (?,?,?,?) ON CONFLICT(connection_id) DO UPDATE SET page_id=excluded.page_id,updated_at=excluded.updated_at WHERE presence.user_id=excluded.user_id',
      connection,
      req.user.id,
      page.id,
      Date.now(),
    );
  else
    await run('DELETE FROM presence WHERE connection_id=? AND user_id=?', connection, req.user.id);
  await run('DELETE FROM presence WHERE updated_at<?', Date.now() - 20000);
  const versions = await all(
    'SELECT DISTINCT w.id AS workspace,v.version FROM workspaces w LEFT JOIN members m ON m.workspace_id=w.id AND m.user_id=? LEFT JOIN workspace_versions v ON v.workspace_id=w.id WHERE m.user_id IS NOT NULL OR w.id IN (SELECT p.workspace_id FROM shares s JOIN pages p ON p.id=s.page_id WHERE s.user_id=?)',
    req.user.id,
    req.user.id,
  );
  const users = access
    ? await asyncFilter(
        await all(
          'SELECT DISTINCT u.id,u.name FROM presence p JOIN users u ON u.id=p.user_id WHERE p.page_id=? AND p.updated_at>?',
          page.id,
          Date.now() - 20000,
        ),
        async (user) => !!(await permission(user, page)),
      )
    : [];
  res.json({ versions, presence: users, accessible: !!access });
});
const rank = {
  view: 1,
  comment: 2,
  edit: 3,
  owner: 4,
};
async function permission(user, page, includeDeleted = false) {
  if (!page) return null;
  const lineage = await all(
    `WITH RECURSIVE lineage AS (
 SELECT id,parent_id,owner_id,visibility,deleted FROM pages WHERE id=?
 UNION ALL SELECT p.id,p.parent_id,p.owner_id,p.visibility,p.deleted FROM pages p JOIN lineage l ON p.id=l.parent_id
 ) SELECT l.*,s.role AS share_role,m.role AS member_role FROM lineage l
 LEFT JOIN shares s ON s.page_id=l.id AND s.user_id=?
 LEFT JOIN members m ON m.workspace_id=? AND m.user_id=?`,
    page.id,
    user.id,
    page.workspace_id,
    user.id,
  );
  let role = null;
  for (const current of lineage) {
    if (current.deleted && !includeDeleted) return null;
    let candidate = current.owner_id === user.id ? 'owner' : current.share_role;
    if (
      current.visibility === 'workspace' &&
      current.member_role &&
      (!candidate || rank[candidate] < 3)
    )
      candidate = 'edit';
    if (rank[candidate] > (rank[role] || 0)) role = candidate;
  }
  return role;
}
async function requirePage(req, role = 'view', deleted = false) {
  const page = await get('SELECT * FROM pages WHERE id=?', req.params.id);
  const access = await permission(req.user, page, deleted);
  if (!access || rank[access] < rank[role])
    fail(403, 'You do not have permission to access or change this page.');
  return page;
}
async function pageJSON(p, user) {
  return {
    ...p,
    properties: JSON.parse(p.properties),
    config: JSON.parse(p.config),
    permission: await permission(user, p, true),
    favorite: !!(await get('SELECT 1 FROM favorites WHERE page_id=? AND user_id=?', p.id, user.id)),
  };
}
async function blocks(id) {
  return await all('SELECT * FROM blocks WHERE page_id=? ORDER BY position,id', id);
}
async function snapshot(page, user) {
  await run(
    'INSERT INTO versions VALUES (?,?,?,?,?)',
    uid(),
    page.id,
    user.id,
    JSON.stringify({
      title: page.title,
      blocks: await blocks(page.id),
    }),
    now(),
  );
  await run(
    'DELETE FROM versions WHERE page_id=? AND id NOT IN (SELECT id FROM versions WHERE page_id=? ORDER BY created_at DESC LIMIT 50)',
    page.id,
    page.id,
  );
}
async function touch(id) {
  await run('UPDATE pages SET updated_at=? WHERE id=?', now(), id);
}
app.get('/api/workspaces', async (req, res) =>
  res.json(
    await all(
      'SELECT DISTINCT w.*,m.role FROM workspaces w LEFT JOIN members m ON m.workspace_id=w.id AND m.user_id=? WHERE m.user_id IS NOT NULL OR w.id IN (SELECT p.workspace_id FROM shares s JOIN pages p ON p.id=s.page_id WHERE s.user_id=?)',
      req.user.id,
      req.user.id,
    ),
  ),
);
app.post('/api/workspaces', async (req, res) => {
  const name = text(req.body.name, 100).trim();
  if (!name) fail(400, 'Name is required');
  const id = await transaction(async () => await createWorkspace(req.user, name));
  res.status(201).json({
    id,
  });
});
app.get('/api/workspaces/:id/members', async (req, res) => {
  if (
    !(await get(
      'SELECT 1 FROM members WHERE workspace_id=? AND user_id=?',
      req.params.id,
      req.user.id,
    ))
  )
    fail(403, 'Workspace membership required');
  res.json(
    await all(
      'SELECT u.id,u.email,u.name,m.role FROM members m JOIN users u ON u.id=m.user_id WHERE workspace_id=?',
      req.params.id,
    ),
  );
});
app.post('/api/workspaces/:id/members', async (req, res) => {
  if (
    !(await get('SELECT 1 FROM workspaces WHERE id=? AND owner_id=?', req.params.id, req.user.id))
  )
    fail(403, 'Only the workspace owner can invite members');
  const user = await get(
    'SELECT id FROM users WHERE email=?',
    text(req.body.email).trim().toLowerCase(),
  );
  if (!user) fail(404, 'This person must create a local account first.');
  await run('INSERT OR IGNORE INTO members VALUES (?,?,?)', req.params.id, user.id, 'member');
  await notify(req.params.id);
  res.json({
    ok: true,
  });
});
app.delete('/api/workspaces/:id/members/:user', async (req, res) => {
  const w = await get(
    'SELECT * FROM workspaces WHERE id=? AND owner_id=?',
    req.params.id,
    req.user.id,
  );
  if (!w || w.owner_id === req.params.user) fail(403, 'Cannot remove this member');
  await run('DELETE FROM members WHERE workspace_id=? AND user_id=?', w.id, req.params.user);
  await notify(w.id);
  res.json({
    ok: true,
  });
});
app.patch('/api/workspaces/:id', async (req, res) => {
  if (
    !(await get('SELECT 1 FROM workspaces WHERE id=? AND owner_id=?', req.params.id, req.user.id))
  )
    fail(403, 'Only the workspace owner can rename it');
  const name = text(req.body.name, 100).trim();
  if (!name) fail(400, 'Name is required');
  await run('UPDATE workspaces SET name=? WHERE id=?', name, req.params.id);
  await notify(req.params.id);
  res.json({
    ok: true,
  });
});
app.get('/api/pages', async (req, res) => {
  const workspace = text(req.query.workspace);
  const trash = req.query.trash === '1';
  res.json(
    await Promise.all(
      (
        await asyncFilter(
          await all('SELECT * FROM pages WHERE workspace_id=? ORDER BY position', workspace),
          async (p) =>
            trash
              ? p.deleted && (await permission(req.user, p, true))
              : await permission(req.user, p),
        )
      ).map(async (p) => await pageJSON(p, req.user)),
    ),
  );
});
app.get('/api/search', async (req, res) => {
  const q = text(req.query.q || '', 200).toLowerCase();
  const list = await asyncFilter(
    await all('SELECT * FROM pages WHERE workspace_id=?', text(req.query.workspace)),
    async (p) => await permission(req.user, p),
  );
  res.json(
    await Promise.all(
      (
        await asyncFilter(
          list,
          async (p) =>
            p.title.toLowerCase().includes(q) ||
            (await blocks(p.id)).some((b) =>
              sanitize(b.html, {
                allowedTags: [],
              })
                .toLowerCase()
                .includes(q),
            ),
        )
      )
        .slice(0, 50)
        .map(async (p) => await pageJSON(p, req.user)),
    ),
  );
});
app.post('/api/pages', async (req, res) => {
  const w = text(req.body.workspace_id);
  let visibility = req.body.visibility === 'workspace' ? 'workspace' : 'private';
  if (req.body.parent_id) {
    const p = await get('SELECT * FROM pages WHERE id=?', text(req.body.parent_id));
    if (!p || p.workspace_id !== w || (rank[await permission(req.user, p)] || 0) < 3)
      fail(403, 'Cannot add a page here');
    visibility = 'private';
  } else if (
    !(await get('SELECT 1 FROM members WHERE workspace_id=? AND user_id=?', w, req.user.id))
  )
    fail(403, 'Workspace membership required');
  const id = await insertPage(req.user, w, {
    title: text(req.body.title || ''),
    parent_id: req.body.parent_id,
    kind: req.body.kind === 'database' ? 'database' : 'page',
    visibility,
    icon: text(req.body.icon || '', 20),
  });
  await notify(w, id);
  res.status(201).json({
    id,
  });
});
app.get('/api/pages/:id', async (req, res) => {
  const p = await requirePage(req);
  res.json({
    ...(await pageJSON(p, req.user)),
    blocks: await blocks(p.id),
  });
});
app.patch('/api/pages/:id', async (req, res) => {
  const p = await requirePage(req, 'edit');
  if (req.body.revision !== p.revision)
    fail(409, 'This page changed in another session. Reload and try again.');
  const data = {
    ...p,
  };
  for (const field of ['title', 'icon', 'cover'])
    if (field in req.body)
      data[field] = text(req.body[field], field === 'title' ? 200 : field === 'cover' ? 1000 : 20);
  if (data.cover && !/^#[0-9a-f]{6}$/i.test(data.cover)) fail(400, 'Invalid cover color');
  if ('visibility' in req.body) {
    if ((await permission(req.user, p)) !== 'owner')
      fail(403, 'Only a page owner can change sharing');
    if (!['private', 'workspace'].includes(req.body.visibility)) fail(400, 'Invalid visibility');
    data.visibility = req.body.visibility;
  }
  if ('parent_id' in req.body) {
    if ((await permission(req.user, p)) !== 'owner') fail(403, 'Only a page owner can move it');
    let parent = req.body.parent_id;
    if (parent) {
      const dest = await get('SELECT * FROM pages WHERE id=?', text(parent));
      if (
        !dest ||
        dest.workspace_id !== p.workspace_id ||
        (rank[await permission(req.user, dest)] || 0) < 3
      )
        fail(403, 'Invalid destination');
      let cursor = dest;
      while (cursor) {
        if (cursor.id === p.id) fail(400, 'Cannot move a page inside itself');
        cursor = cursor.parent_id
          ? await get('SELECT * FROM pages WHERE id=?', cursor.parent_id)
          : null;
      }
    } else if (
      !(await get(
        'SELECT 1 FROM members WHERE workspace_id=? AND user_id=?',
        p.workspace_id,
        req.user.id,
      ))
    )
      fail(403, 'Workspace membership required');
    data.parent_id = parent || null;
  }
  if ('full_width' in req.body) data.full_width = req.body.full_width ? 1 : 0;
  if ('properties' in req.body) {
    if (
      typeof req.body.properties !== 'object' ||
      Array.isArray(req.body.properties) ||
      !req.body.properties
    )
      fail(400, 'Invalid properties');
    data.properties = JSON.stringify(req.body.properties);
    if (data.properties.length > 50000) fail(400, 'Properties too large');
    const parent = p.parent_id ? await get('SELECT * FROM pages WHERE id=?', p.parent_id) : null;
    if (parent?.kind === 'database') {
      const values = {
        ...req.body.properties,
      };
      for (const prop of JSON.parse(parent.config).properties) {
        const value = values[prop.id];
        if (value === undefined || value === '') continue;
        if (prop.type === 'number') {
          if (!['string', 'number'].includes(typeof value) || !Number.isFinite(Number(value)))
            fail(400, `${prop.name} must be a number`);
          values[prop.id] = Number(value);
        } else if (prop.type === 'checkbox') {
          if (typeof value !== 'boolean') fail(400, `${prop.name} must be a checkbox value`);
        } else {
          text(value, 5000);
          if (prop.type === 'select' && !prop.options.includes(value))
            fail(400, `Invalid ${prop.name} option`);
          if (
            prop.type === 'date' &&
            (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)))
          )
            fail(400, `${prop.name} must be a date`);
          if (prop.type === 'url' && !/^https?:\/\//i.test(value))
            fail(400, `${prop.name} must be an http or https URL`);
        }
      }
      data.properties = JSON.stringify(values);
    }
  }
  if ('config' in req.body) {
    const c = req.body.config;
    if (
      p.kind !== 'database' ||
      !c ||
      !Array.isArray(c.properties) ||
      !Array.isArray(c.views) ||
      c.views.length < 1 ||
      c.views.length > 20 ||
      c.properties.length > 30
    )
      fail(400, 'Invalid database configuration');
    for (const prop of c.properties) {
      text(prop.id, 100);
      text(prop.name, 100);
      if (!['text', 'number', 'select', 'date', 'checkbox', 'url'].includes(prop.type))
        fail(400, 'Invalid property type');
      if (
        prop.type === 'select' &&
        (!Array.isArray(prop.options) ||
          prop.options.some((o) => typeof o !== 'string' || o.length > 100) ||
          prop.options.length > 50)
      )
        fail(400, 'Invalid select options');
    }
    for (const view of c.views) {
      text(view.id, 100);
      text(view.name, 100);
      if (!['table', 'board', 'list', 'gallery', 'calendar'].includes(view.type))
        fail(400, 'Invalid view type');
    }
    data.config = JSON.stringify(c);
    if (data.config.length > 50000) fail(400, 'Configuration too large');
  }
  const updated = await run(
    'UPDATE pages SET title=?,icon=?,cover=?,parent_id=?,visibility=?,full_width=?,properties=?,config=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?',
    data.title,
    data.icon,
    data.cover,
    data.parent_id,
    data.visibility,
    data.full_width,
    data.properties,
    data.config,
    now(),
    p.id,
    p.revision,
  );
  if (updated.changes !== 1)
    fail(409, 'This page changed in another session. Reload and try again.');
  await notify(p.workspace_id, p.id);
  res.json(await pageJSON(await get('SELECT * FROM pages WHERE id=?', p.id), req.user));
});
app.post('/api/pages/:id/trash', async (req, res) => {
  const p = await requirePage(req, 'edit', true);
  await run(
    'UPDATE pages SET deleted=?,updated_at=? WHERE id=?',
    req.body.restore ? 0 : 1,
    now(),
    p.id,
  );
  await notify(p.workspace_id, p.id);
  res.json({
    ok: true,
  });
});
app.post('/api/pages/:id/duplicate', async (req, res) => {
  const p = await requirePage(req);
  if (
    !(await get(
      'SELECT 1 FROM members WHERE workspace_id=? AND user_id=?',
      p.workspace_id,
      req.user.id,
    ))
  )
    fail(403, 'Workspace membership required');
  const id = await transaction(async () => {
    async function copy(source, parent, root = false) {
      const id = await insertPage(req.user, p.workspace_id, {
        title: source.title + (root ? ' (copy)' : ''),
        kind: source.kind,
        parent_id: parent,
        icon: source.icon,
      });
      await run(
        'UPDATE pages SET cover=?,properties=?,config=? WHERE id=?',
        source.cover,
        source.properties,
        source.config,
        id,
      );
      await run('DELETE FROM blocks WHERE page_id=?', id);
      for (const b of await blocks(source.id))
        await run(
          'INSERT INTO blocks VALUES (?,?,?,?,?,?,?,?)',
          uid(),
          id,
          b.type,
          b.html,
          b.checked,
          b.indent,
          b.position,
          0,
        );
      for (const child of await asyncFilter(
        await all('SELECT * FROM pages WHERE parent_id=? AND deleted=0', source.id),
        async (c) => await permission(req.user, c),
      ))
        await copy(child, id);
      return id;
    }
    return await copy(p, null, true);
  });
  await notify(p.workspace_id, id);
  res.status(201).json({
    id,
  });
});
app.post('/api/pages/:id/favorite', async (req, res) => {
  const p = await requirePage(req);
  if (req.body.favorite)
    await run('INSERT OR IGNORE INTO favorites VALUES (?,?)', p.id, req.user.id);
  else await run('DELETE FROM favorites WHERE page_id=? AND user_id=?', p.id, req.user.id);
  res.json({
    ok: true,
  });
});
const types = [
  'text',
  'heading1',
  'heading2',
  'heading3',
  'bullet',
  'number',
  'todo',
  'toggle',
  'quote',
  'callout',
  'code',
  'divider',
  'image',
  'bookmark',
];
app.post('/api/pages/:id/blocks', async (req, res) => {
  const p = await requirePage(req, 'edit'),
    b = req.body;
  const type = types.includes(b.type) ? b.type : 'text';
  const list = await blocks(p.id);
  const index = b.after ? list.findIndex((x) => x.id === b.after) : -1;
  const position =
    index >= 0
      ? (list[index].position + (list[index + 1]?.position ?? list[index].position + 2)) / 2
      : (list.at(-1)?.position ?? -1) + 1;
  const id = uid();
  await snapshot(p, req.user);
  await run(
    'INSERT INTO blocks (id,page_id,type,html,position,indent) VALUES (?,?,?,?,?,?)',
    id,
    p.id,
    type,
    clean(b.html || ''),
    position,
    Math.min(5, Math.max(0, Number(b.indent) || 0)),
  );
  await touch(p.id);
  await notify(p.workspace_id, p.id);
  res.status(201).json(await get('SELECT * FROM blocks WHERE id=?', id));
});
app.patch('/api/pages/:id/blocks/:block', async (req, res) => {
  const p = await requirePage(req, 'edit'),
    b = await get('SELECT * FROM blocks WHERE id=? AND page_id=?', req.params.block, p.id);
  if (!b) fail(404, 'Block not found');
  if (req.body.revision !== b.revision)
    fail(
      409,
      'Someone else edited this block. Your change was not saved; copy it before reloading.',
    );
  const n = {
    ...b,
  };
  if ('html' in req.body) n.html = clean(req.body.html);
  if ('type' in req.body) {
    if (!types.includes(req.body.type)) fail(400, 'Invalid block type');
    n.type = req.body.type;
  }
  if ('checked' in req.body) n.checked = req.body.checked ? 1 : 0;
  if ('indent' in req.body) n.indent = Math.min(5, Math.max(0, Number(req.body.indent) || 0));
  await snapshot(p, req.user);
  const updated = await run(
    'UPDATE blocks SET type=?,html=?,checked=?,indent=?,revision=revision+1 WHERE id=? AND revision=?',
    n.type,
    n.html,
    n.checked,
    n.indent,
    b.id,
    b.revision,
  );
  if (updated.changes !== 1)
    fail(
      409,
      'Someone else edited this block. Your change was not saved; copy it before reloading.',
    );
  await touch(p.id);
  await notify(p.workspace_id, p.id);
  res.json(await get('SELECT * FROM blocks WHERE id=?', b.id));
});
app.delete('/api/pages/:id/blocks/:block', async (req, res) => {
  const p = await requirePage(req, 'edit');
  await snapshot(p, req.user);
  await run('DELETE FROM blocks WHERE id=? AND page_id=?', req.params.block, p.id);
  await touch(p.id);
  await notify(p.workspace_id, p.id);
  res.json({
    ok: true,
  });
});
app.post('/api/pages/:id/reorder', async (req, res) => {
  const p = await requirePage(req, 'edit');
  const ids = req.body.ids,
    existing = await blocks(p.id);
  if (
    !Array.isArray(ids) ||
    ids.length !== existing.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !existing.some((b) => b.id === id))
  )
    fail(409, 'The block list changed. Reload before reordering.');
  await transaction(
    async () =>
      await asyncEach(
        ids,
        async (id, i) => await run('UPDATE blocks SET position=? WHERE id=?', i, id),
      ),
  );
  await touch(p.id);
  await notify(p.workspace_id, p.id);
  res.json({
    ok: true,
  });
});
app.post('/api/pages/:id/publish', async (req, res) => {
  const p = await requirePage(req, 'owner');
  const token = req.body.enabled ? p.public_token || randomBytes(24).toString('hex') : null;
  await run(
    'UPDATE pages SET public_token=?,revision=revision+1,updated_at=? WHERE id=?',
    token,
    now(),
    p.id,
  );
  await notify(p.workspace_id, p.id);
  res.json({
    token,
  });
});
app.post('/api/pages/:id/import', async (req, res) => {
  const p = await requirePage(req, 'edit');
  const markdown = text(req.body.markdown, 500000);
  const entries = [];
  let code = null;
  for (const line of markdown.replaceAll('\r', '').split('\n')) {
    if (line.startsWith('\x60\x60\x60')) {
      if (code !== null) {
        entries.push({
          type: 'code',
          html: code.join('\n'),
        });
        code = null;
      } else code = [];
      continue;
    }
    if (code !== null) {
      code.push(line);
      continue;
    }
    if (!line.trim()) continue;
    let type = 'text',
      value = line,
      checked = 0;
    const heading = line.match(/^(#{1,3}) (.*)$/);
    if (heading) {
      type = 'heading' + heading[1].length;
      value = heading[2];
    } else if (/^[-*] \[[ xX]\] /.test(line)) {
      type = 'todo';
      checked = /^[-*] \[[xX]\]/.test(line) ? 1 : 0;
      value = line.slice(6);
    } else if (/^[-*] /.test(line)) {
      type = 'bullet';
      value = line.slice(2);
    } else if (/^\d+\. /.test(line)) {
      type = 'number';
      value = line.replace(/^\d+\. /, '');
    } else if (line.startsWith('> ')) {
      type = 'quote';
      value = line.slice(2);
    } else if (/^---+$/.test(line.trim())) {
      type = 'divider';
      value = '';
    }
    entries.push({
      type,
      html: value,
      checked,
    });
  }
  if (code !== null)
    entries.push({
      type: 'code',
      html: code.join('\n'),
    });
  if (entries.length > 2000) fail(400, 'Import supports at most 2,000 blocks');
  await transaction(async () => {
    await snapshot(p, req.user);
    let position = ((await blocks(p.id)).at(-1)?.position || 0) + 1;
    for (const b of entries) {
      const html = b.html.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      await run(
        'INSERT INTO blocks (id,page_id,type,html,checked,position) VALUES (?,?,?,?,?,?)',
        uid(),
        p.id,
        b.type,
        html,
        b.checked || 0,
        position++,
      );
    }
    await touch(p.id);
  });
  await notify(p.workspace_id, p.id);
  res.json({
    count: entries.length,
  });
});
app.get('/api/pages/:id/shares', async (req, res) => {
  const p = await requirePage(req, 'owner');
  res.json(
    await all(
      'SELECT u.id,u.name,u.email,s.role FROM shares s JOIN users u ON u.id=s.user_id WHERE s.page_id=?',
      p.id,
    ),
  );
});
app.post('/api/pages/:id/shares', async (req, res) => {
  const p = await requirePage(req, 'owner');
  const user = await get(
    'SELECT id FROM users WHERE email=?',
    text(req.body.email).toLowerCase().trim(),
  );
  if (!user) fail(404, 'Ask this person to create a local account first.');
  if (!['view', 'comment', 'edit'].includes(req.body.role)) fail(400, 'Invalid permission');
  if (user.id === p.owner_id) fail(400, 'The owner already has full access');
  await run(
    'INSERT INTO shares VALUES (?,?,?) ON CONFLICT(page_id,user_id) DO UPDATE SET role=excluded.role',
    p.id,
    user.id,
    req.body.role,
  );
  await notify(p.workspace_id, p.id);
  res.json({
    ok: true,
  });
});
app.delete('/api/pages/:id/shares/:user', async (req, res) => {
  const p = await requirePage(req, 'owner');
  await run('DELETE FROM shares WHERE page_id=? AND user_id=?', p.id, req.params.user);
  await notify(p.workspace_id, p.id);
  res.json({
    ok: true,
  });
});
app.get('/api/pages/:id/comments', async (req, res) => {
  const p = await requirePage(req);
  res.json(
    await all(
      'SELECT c.*,u.name FROM comments c JOIN users u ON u.id=c.user_id WHERE page_id=? ORDER BY c.created_at',
      p.id,
    ),
  );
});
app.post('/api/pages/:id/comments', async (req, res) => {
  const p = await requirePage(req, 'comment'),
    body = text(req.body.body, 5000).trim();
  if (!body) fail(400, 'Write a comment first');
  await run('INSERT INTO comments VALUES (?,?,?,?,?,?)', uid(), p.id, req.user.id, body, 0, now());
  await notify(p.workspace_id, p.id);
  res.status(201).json({
    ok: true,
  });
});
app.patch('/api/pages/:id/comments/:comment', async (req, res) => {
  const p = await requirePage(req, 'comment');
  const c = await get('SELECT * FROM comments WHERE id=? AND page_id=?', req.params.comment, p.id);
  if (!c) fail(404, 'Comment not found');
  if (c.user_id !== req.user.id && (rank[await permission(req.user, p)] || 0) < 3)
    fail(403, 'Cannot resolve this comment');
  await run('UPDATE comments SET resolved=? WHERE id=?', req.body.resolved ? 1 : 0, c.id);
  await notify(p.workspace_id, p.id);
  res.json({
    ok: true,
  });
});
app.get('/api/pages/:id/versions', async (req, res) => {
  const p = await requirePage(req, 'edit');
  res.json(
    await all(
      'SELECT v.id,v.created_at,u.name FROM versions v JOIN users u ON u.id=v.user_id WHERE page_id=? ORDER BY v.created_at DESC LIMIT 50',
      p.id,
    ),
  );
});
app.post('/api/pages/:id/versions/:version', async (req, res) => {
  const p = await requirePage(req, 'edit');
  const v = await get('SELECT * FROM versions WHERE id=? AND page_id=?', req.params.version, p.id);
  if (!v) fail(404, 'Version not found');
  await transaction(async () => {
    await snapshot(p, req.user);
    const s = JSON.parse(v.snapshot);
    await run(
      'UPDATE pages SET title=?,revision=revision+1,updated_at=? WHERE id=?',
      s.title,
      now(),
      p.id,
    );
    await run('DELETE FROM blocks WHERE page_id=?', p.id);
    for (const b of s.blocks)
      await run(
        'INSERT INTO blocks VALUES (?,?,?,?,?,?,?,?)',
        uid(),
        p.id,
        b.type,
        b.html,
        b.checked,
        b.indent,
        b.position,
        0,
      );
  });
  await notify(p.workspace_id, p.id);
  res.json({
    ok: true,
  });
});
app.get('/api/pages/:id/export', async (req, res) => {
  const p = await requirePage(req);
  const plain = (html) =>
    sanitize(html, {
      allowedTags: [],
      allowedAttributes: {},
    })
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  let md =
    `# ${p.title || 'Untitled'}\n\n` +
    (await blocks(p.id))
      .map((b) => {
        const prefix =
          {
            heading1: '# ',
            heading2: '## ',
            heading3: '### ',
            bullet: '- ',
            number: '1. ',
            todo: b.checked ? '- [x] ' : '- [ ] ',
            quote: '> ',
            callout: '> ',
          }[b.type] || '';
        return b.type === 'divider'
          ? '---'
          : b.type === 'code'
            ? '```\n' + plain(b.html) + '\n```'
            : prefix + plain(b.html);
      })
      .join('\n\n');
  if (p.kind === 'database') {
    const props = JSON.parse(p.config).properties || [];
    md +=
      '\n\n| Name | ' +
      props.map((x) => x.name).join(' | ') +
      ' |\n| --- | ' +
      props.map(() => '---').join(' | ') +
      ' |\n';
    md += (
      await asyncFilter(
        await all('SELECT * FROM pages WHERE parent_id=?', p.id),
        async (x) => await permission(req.user, x),
      )
    )
      .map(
        (x) =>
          '| ' +
          [x.title, ...props.map((prop) => JSON.parse(x.properties)[prop.id] ?? '')]
            .map((v) => String(v).replaceAll('|', '\\|'))
            .join(' | ') +
          ' |',
      )
      .join('\n');
  }
  res.type('text/markdown').send(md);
});
// Socket messages contain no document content; only authorized recipients receive invalidations.
io.use(async (socket, next) => {
  const user = await userForCookie(socket.handshake.headers.cookie);
  if (!user) return next(new Error('Unauthorized'));
  socket.user = user;
  next();
});
async function notify(workspace, page) {
  await run(
    'INSERT INTO workspace_versions (workspace_id,version) VALUES (?,?) ON CONFLICT(workspace_id) DO UPDATE SET version=excluded.version',
    workspace,
    uid(),
  );
  if (process.env.VERCEL) return;
  for (const socket of io.sockets.sockets.values()) {
    if (!(await userForCookie(socket.handshake.headers.cookie))) {
      socket.disconnect();
      continue;
    }
    const isMember = await get(
      'SELECT 1 FROM members WHERE workspace_id=? AND user_id=?',
      workspace,
      socket.user.id,
    );
    const hasShare = await get(
      'SELECT 1 FROM shares s JOIN pages p ON p.id=s.page_id WHERE p.workspace_id=? AND s.user_id=?',
      workspace,
      socket.user.id,
    );
    if (isMember || hasShare || socket.currentWorkspace === workspace) {
      const canSeePage =
        page && (await permission(socket.user, await get('SELECT * FROM pages WHERE id=?', page)));
      socket.emit('invalidate', {
        workspace,
        page: canSeePage || socket.currentPage === page ? page : undefined,
      });
    }
  }
  await broadcastPresence();
}
async function broadcastPresence() {
  for (const socket of io.sockets.sockets.values()) {
    if (!socket.currentPage) continue;
    const p = await get('SELECT * FROM pages WHERE id=?', socket.currentPage);
    if (!(await permission(socket.user, p))) {
      socket.emit('presence', []);
      socket.currentPage = null;
      continue;
    }
    const users = [
      ...new Map(
        (
          await asyncFilter(
            [...io.sockets.sockets.values()],
            async (s) => s.currentPage === p.id && (await permission(s.user, p)),
          )
        ).map((s) => [
          s.user.id,
          {
            id: s.user.id,
            name: s.user.name,
          },
        ]),
      ).values(),
    ];
    socket.emit('presence', users);
  }
}
io.on('connection', (socket) => {
  socket.on('page', async (id) => {
    const p = typeof id === 'string' ? await get('SELECT * FROM pages WHERE id=?', id) : null;
    socket.currentPage = (await permission(socket.user, p)) ? id : null;
    socket.currentWorkspace = p?.workspace_id;
    await broadcastPresence();
  });
  socket.on('disconnect', broadcastPresence);
});
app.use('/api', (req, res) =>
  res.status(404).json({
    error: 'API route not found',
  }),
);
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (!err.status) console.error(err);
  res.status(err.status || 500).json({
    error: err.status ? err.message : 'An unexpected server error occurred.',
  });
});
if (!process.env.VERCEL && process.argv.includes('--production')) {
  app.use(express.static(resolve('dist')));
  app.get('/{*path}', (req, res) => res.sendFile(resolve('dist/index.html')));
} else if (!process.env.VERCEL) {
  const { createServer } = await import('vite');
  const vite = await createServer({
    server: {
      middlewareMode: true,
    },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 3000),
  host = process.env.HOST || '127.0.0.1';
if (!process.env.VERCEL)
  http.listen(port, host, () => console.log(`Notion Local running at http://${host}:${port}`));
function shutdown() {
  io.close();
  http.close(async () => {
    await db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
if (!process.env.VERCEL) {
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
export default app;
async function asyncFilter(items, predicate) {
  const checks = await Promise.all(items.map(predicate));
  return items.filter((_, i) => checks[i]);
}

async function asyncEach(items, fn) {
  for (let i = 0; i < items.length; i++) await fn(items[i], i);
}
