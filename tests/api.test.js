import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io } from 'socket.io-client';
const dir = mkdtempSync(join(tmpdir(), 'notion-test-')),
  port = 3102,
  base = `http://127.0.0.1:${port}`;
let server,
  output = '';
async function start() {
  server = spawn(process.execPath, ['server/index.js', '--production'], {
    env: {
      ...process.env,
      DATABASE_URL: '',
      PORT: String(port),
      DATABASE_PATH: join(dir, 'test.sqlite'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (x) => (output += x));
  server.stderr.on('data', (x) => (output += x));
  for (let i = 0; i < 300; i++) {
    try {
      await fetch(base + '/api/me');
      return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Test server did not become ready: ' + output);
}
async function stop() {
  if (!server || server.exitCode !== null) return;
  const done = new Promise((r) => server.once('exit', r));
  server.kill();
  await done;
}
function client() {
  let cookie = '';
  return {
    async req(path, method = 'GET', body) {
      const res = await fetch(base + '/api' + path, {
        method,
        headers: { cookie, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.headers.get('set-cookie')) cookie = res.headers.get('set-cookie').split(';')[0];
      const data = await res.json();
      return { status: res.status, data };
    },
    get cookie() {
      return cookie;
    },
  };
}
const a = client(),
  b = client(),
  c = client();
let workspace, page, child, block, dbPage, row;
before(start);
after(async () => {
  await stop();
  rmSync(dir, { recursive: true, force: true });
});
test('accounts use secure sessions and create separate persistent workspaces', async () => {
  for (const [client, name] of [
    [a, 'Alice'],
    [b, 'Bob'],
    [c, 'Carol'],
  ]) {
    const r = await client.req('/auth/register', 'POST', {
      name,
      email: name.toLowerCase() + '@example.com',
      password: 'correct-horse-123',
    });
    assert.equal(r.status, 201);
    assert.ok(client.cookie);
    assert.equal(r.data.password, undefined);
  }
  workspace = (await a.req('/workspaces')).data[0].id;
  page = (await a.req('/pages?workspace=' + workspace)).data[0];
  block = (await a.req('/pages/' + page.id)).data.blocks[0];
  assert.equal((await b.req('/pages?workspace=' + workspace)).data.length, 0);
  assert.equal((await c.req('/pages/' + page.id)).status, 403);
  assert.equal((await client().req('/me')).status, 401);
  assert.equal(
    (
      await client().req('/auth/login', 'POST', {
        email: 'alice@example.com',
        password: 'incorrect',
      })
    ).status,
    401,
  );
});
test('nested pages reject unauthorized creation, moving, and hierarchy cycles', async () => {
  assert.equal(
    (await b.req('/pages', 'POST', { workspace_id: workspace, parent_id: page.id })).status,
    403,
  );
  child = (
    await a.req('/pages', 'POST', { workspace_id: workspace, parent_id: page.id, title: 'Nested' })
  ).data;
  assert.equal(
    (await a.req('/pages/' + page.id, 'PATCH', { revision: 0, parent_id: child.id })).status,
    400,
  );
  assert.equal((await b.req('/pages/' + child.id)).status, 403);
});
test('sharing roles are inherited, enforced, changed, and revoked', async () => {
  assert.equal(
    (await a.req(`/pages/${page.id}/shares`, 'POST', { email: 'bob@example.com', role: 'view' }))
      .status,
    200,
  );
  assert.equal((await b.req('/pages/' + child.id)).status, 200);
  assert.equal(
    (await b.req('/pages/' + page.id, 'PATCH', { revision: 0, title: 'Denied' })).status,
    403,
  );
  assert.equal((await b.req(`/pages/${page.id}/comments`, 'POST', { body: 'Denied' })).status, 403);
  assert.equal((await b.req(`/pages/${page.id}/blocks`, 'POST', { html: 'Denied' })).status, 403);
  await a.req(`/pages/${page.id}/shares`, 'POST', { email: 'bob@example.com', role: 'comment' });
  assert.equal(
    (await b.req(`/pages/${page.id}/comments`, 'POST', { body: 'A real comment' })).status,
    201,
  );
  assert.equal(
    (await b.req(`/pages/${page.id}/shares`, 'POST', { email: 'carol@example.com', role: 'edit' }))
      .status,
    403,
  );
  await a.req(`/pages/${page.id}/shares`, 'POST', { email: 'bob@example.com', role: 'edit' });
  assert.equal(
    (await b.req(`/pages/${page.id}/blocks`, 'POST', { html: 'Collaborator text' })).status,
    201,
  );
  const bob = (await b.req('/me')).data;
  await a.req(`/pages/${page.id}/shares/${bob.id}`, 'DELETE');
  assert.equal((await b.req('/pages/' + child.id)).status, 403);
});
test('block edits sanitize HTML and reject concurrent overwrites', async () => {
  const result = await a.req(`/pages/${page.id}/blocks/${block.id}`, 'PATCH', {
    revision: 0,
    html: '<b>Persist me</b><script>alert(1)</script><a href="javascript:alert(1)">safe</a><img src=x onerror=alert(1)>',
  });
  assert.equal(result.status, 200);
  assert.ok(result.data.html.includes('<b>Persist me</b>'));
  assert.ok(!/script|onerror|javascript/.test(result.data.html));
  assert.equal(
    (await a.req(`/pages/${page.id}/blocks/${block.id}`, 'PATCH', { revision: 0, html: 'stale' }))
      .status,
    409,
  );
  assert.equal((await a.req(`/pages/${page.id}/reorder`, 'POST', { ids: [block.id] })).status, 409);
});
test('workspace membership exposes workspace pages but keeps private pages separate', async () => {
  await a.req(`/workspaces/${workspace}/members`, 'POST', { email: 'bob@example.com' });
  await a.req('/pages/' + page.id, 'PATCH', { revision: 0, visibility: 'workspace' });
  assert.equal((await b.req('/pages/' + child.id)).status, 200);
  const privatePage = (
    await a.req('/pages', 'POST', { workspace_id: workspace, title: 'Private secret' })
  ).data;
  assert.equal((await b.req('/pages/' + privatePage.id)).status, 403);
  assert.equal(
    (await b.req('/pages/' + privatePage.id, 'PATCH', { revision: 0, title: 'No' })).status,
    403,
  );
  assert.equal(
    (await b.req(`/workspaces/${workspace}/members`, 'POST', { email: 'carol@example.com' }))
      .status,
    403,
  );
});
test('databases persist typed properties and multiple views; records are pages', async () => {
  dbPage = (
    await a.req('/pages', 'POST', { workspace_id: workspace, title: 'Projects', kind: 'database' })
  ).data;
  const db = (await a.req('/pages/' + dbPage.id)).data;
  assert.equal(db.config.properties[0].type, 'select');
  db.config.views.push({
    id: 'board',
    name: 'Board',
    type: 'board',
    sort: 'asc',
    filter: 'In progress',
  });
  assert.equal(
    (await a.req('/pages/' + dbPage.id, 'PATCH', { revision: 0, config: db.config })).status,
    200,
  );
  row = (
    await a.req('/pages', 'POST', {
      workspace_id: workspace,
      parent_id: dbPage.id,
      title: 'Ship product',
    })
  ).data;
  assert.equal(
    (
      await a.req('/pages/' + row.id, 'PATCH', {
        revision: 0,
        properties: { status: 'In progress', date: '2026-10-01' },
      })
    ).status,
    200,
  );
  assert.equal((await a.req('/pages/' + row.id)).data.properties.status, 'In progress');
  assert.equal((await b.req('/pages/' + row.id)).status, 403);
});
test('search respects access and searches saved block text', async () => {
  const found = await a.req('/search?workspace=' + workspace + '&q=Persist%20me');
  assert.ok(found.data.some((p) => p.id === page.id));
  assert.equal((await c.req('/search?workspace=' + workspace + '&q=Persist')).data.length, 0);
});
test('trash hides descendants, restore recovers content, and duplicate copies subtree', async () => {
  await a.req(`/pages/${dbPage.id}/trash`, 'POST', {});
  assert.equal((await a.req('/pages/' + row.id)).status, 403);
  assert.ok(
    (await a.req('/pages?workspace=' + workspace + '&trash=1')).data.some(
      (p) => p.id === dbPage.id,
    ),
  );
  await a.req(`/pages/${dbPage.id}/trash`, 'POST', { restore: true });
  assert.equal((await a.req('/pages/' + row.id)).status, 200);
  const copy = (await a.req(`/pages/${dbPage.id}/duplicate`, 'POST')).data;
  const children = (await a.req('/pages?workspace=' + workspace)).data.filter(
    (p) => p.parent_id === copy.id,
  );
  assert.equal(children.length, 1);
  assert.equal(children[0].properties.status, 'In progress');
});
test('page history restores snapshots and favorites persist per account', async () => {
  const versions = (await a.req(`/pages/${page.id}/versions`)).data;
  assert.ok(versions.length);
  await a.req(`/pages/${page.id}/favorite`, 'POST', { favorite: true });
  assert.equal((await a.req('/pages/' + page.id)).data.favorite, true);
  assert.equal((await b.req('/pages/' + page.id)).data.favorite, false);
  const before = (await a.req('/pages/' + child.id)).data;
  await a.req(`/pages/${child.id}/blocks/${before.blocks[0].id}`, 'PATCH', {
    revision: 0,
    html: 'Changed',
  });
  const history = (await a.req(`/pages/${child.id}/versions`)).data;
  await a.req(`/pages/${child.id}/versions/${history[0].id}`, 'POST');
  assert.equal((await a.req('/pages/' + child.id)).data.blocks[0].html, '');
});
test('authenticated collaboration sends presence and update events', async () => {
  const sa = io(base, { extraHeaders: { Cookie: a.cookie }, transports: ['websocket'] }),
    sb = io(base, { extraHeaders: { Cookie: b.cookie }, transports: ['websocket'] });
  try {
    await Promise.all(
      [sa, sb].map(
        (s) =>
          new Promise((resolve, reject) => {
            s.on('connect', resolve);
            s.on('connect_error', reject);
          }),
      ),
    );
    const presence = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No presence')), 5000);
      sa.on('presence', (users) => {
        if (users.length === 2) {
          clearTimeout(timer);
          resolve(users);
        }
      });
    });
    sa.emit('page', page.id);
    sb.emit('page', page.id);
    assert.equal((await presence).length, 2);
    const update = new Promise((resolve) => sb.once('invalidate', resolve));
    await a.req(`/pages/${page.id}/blocks`, 'POST', { html: 'Live update' });
    assert.equal((await update).page, page.id);
  } finally {
    sa.disconnect();
    sb.disconnect();
  }
});
test('data and login sessions survive a full server restart', async () => {
  await stop();
  await start();
  assert.equal((await a.req('/me')).data.email, 'alice@example.com');
  const p = (await a.req('/pages/' + page.id)).data;
  assert.ok(p.blocks.some((b) => b.html.includes('Persist me')));
  assert.ok(p.blocks.some((b) => b.html === 'Live update'));
  assert.equal((await a.req('/pages/' + row.id)).data.properties.status, 'In progress');
});
test('logout revokes the session and cross-origin writes are rejected', async () => {
  const bad = await fetch(base + '/api/pages', {
    method: 'POST',
    headers: {
      cookie: a.cookie,
      Origin: 'https://evil.example',
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  assert.equal(bad.status, 403);
  await c.req('/auth/logout', 'POST');
  assert.equal((await c.req('/me')).status, 401);
});

test('public links are read-only, include descendants, and can be revoked', async () => {
  const root = (
    await a.req('/pages', 'POST', { workspace_id: workspace, title: 'Published handbook' })
  ).data;
  const nested = (
    await a.req('/pages', 'POST', {
      workspace_id: workspace,
      parent_id: root.id,
      title: 'Public child',
    })
  ).data;
  assert.equal((await b.req(`/pages/${root.id}/publish`, 'POST', { enabled: true })).status, 403);
  const publication = await a.req(`/pages/${root.id}/publish`, 'POST', { enabled: true });
  assert.equal(publication.status, 200);
  const anon = client();
  const result = await anon.req('/public/' + publication.data.token);
  assert.equal(result.status, 200);
  assert.ok(result.data.pages.some((p) => p.id === nested.id));
  assert.equal(result.data.pages[0].owner_id, undefined);
  assert.equal(
    (await anon.req(`/pages/${root.id}`, 'PATCH', { revision: 1, title: 'No' })).status,
    401,
  );
  await a.req(`/pages/${root.id}/publish`, 'POST', { enabled: false });
  assert.equal((await anon.req('/public/' + publication.data.token)).status, 404);
});

test('Markdown import persists real blocks and inherited collaborators cannot keep ownership after revocation', async () => {
  const root = (await a.req('/pages', 'POST', { workspace_id: workspace, title: 'Import test' }))
    .data;
  const result = await a.req(`/pages/${root.id}/import`, 'POST', {
    markdown: '# Heading\n\n- [x] Complete\n- Item\n> Quote\n---\n```js\nconst x = 1;\n```',
  });
  assert.equal(result.status, 200);
  const content = (await a.req('/pages/' + root.id)).data.blocks;
  assert.ok(content.some((b) => b.type === 'todo' && b.checked));
  assert.ok(content.some((b) => b.type === 'code' && b.html === 'const x = 1;'));
  await a.req(`/pages/${root.id}/shares`, 'POST', { email: 'bob@example.com', role: 'edit' });
  const guestChild = (
    await b.req('/pages', 'POST', {
      workspace_id: workspace,
      parent_id: root.id,
      title: 'Guest child',
    })
  ).data;
  assert.equal((await b.req('/pages/' + guestChild.id)).data.permission, 'edit');
  const bob = (await b.req('/me')).data;
  await a.req(`/pages/${root.id}/shares/${bob.id}`, 'DELETE');
  assert.equal((await b.req('/pages/' + guestChild.id)).status, 403);
});

test('cloud polling enforces private presence, reports changes and revocation', async () => {
  const root = (await a.req('/pages', 'POST', { workspace_id: workspace, title: 'Cloud sync' }))
    .data;
  const connectionA = crypto.randomUUID(),
    connectionB = crypto.randomUUID();
  const first = await a.req('/sync', 'POST', { connection: connectionA, page: root.id });
  assert.equal(first.status, 200);
  assert.equal(first.data.accessible, true);
  assert.equal(
    (await b.req('/sync', 'POST', { connection: connectionB, page: root.id })).data.accessible,
    false,
  );
  await a.req(`/pages/${root.id}/shares`, 'POST', { email: 'bob@example.com', role: 'edit' });
  const joined = (await b.req('/sync', 'POST', { connection: connectionB, page: root.id })).data;
  assert.equal(joined.accessible, true);
  assert.equal(joined.presence.length, 2);
  const updated = (await a.req('/sync', 'POST', { connection: connectionA, page: root.id })).data;
  assert.notDeepEqual(updated.versions, first.data.versions);
  const bob = (await b.req('/me')).data;
  await a.req(`/pages/${root.id}/shares/${bob.id}`, 'DELETE');
  assert.equal(
    (await b.req('/sync', 'POST', { connection: connectionB, page: root.id })).data.accessible,
    false,
  );
  assert.equal(
    (await a.req('/sync', 'POST', { connection: connectionA, page: root.id })).data.presence.length,
    1,
  );
});

test('simultaneous block writes accept exactly one matching revision', async () => {
  const root = (await a.req('/pages', 'POST', { workspace_id: workspace, title: 'Concurrent' }))
    .data;
  const block = (await a.req('/pages/' + root.id)).data.blocks[0];
  const results = await Promise.all(
    ['First', 'Second'].map((html) =>
      a.req(`/pages/${root.id}/blocks/${block.id}`, 'PATCH', { html, revision: block.revision }),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
});
