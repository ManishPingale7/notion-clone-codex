import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';
if (process.env.VERCEL && !process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be configured for persistent cloud storage.');
}
export const postgres = !!process.env.DATABASE_URL;
const context = new AsyncLocalStorage();
let sqlite,
  pool,
  tail = Promise.resolve();
async function locked(fn) {
  const previous = tail;
  let release;
  tail = new Promise((r) => (release = r));
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}
function translate(sql) {
  let i = 0;
  let converted = sql.replace(/\?/g, () => '$' + ++i);
  if (/^INSERT OR IGNORE/i.test(converted))
    converted = converted.replace(/^INSERT OR IGNORE/i, 'INSERT') + ' ON CONFLICT DO NOTHING';
  return converted;
}
async function query(sql, args = []) {
  if (postgres) {
    const client = context.getStore() || pool;
    return client.query(translate(sql), args);
  }
  const execute = () => {
    const statement = sqlite.prepare(sql);
    if (/^\s*(SELECT|WITH|PRAGMA)/i.test(sql)) return { rows: statement.all(...args) };
    const result = statement.run(...args);
    return { rows: [], rowCount: result.changes };
  };
  return context.getStore() ? execute() : locked(execute);
}
export const uid = () => randomUUID();
export const now = () => new Date().toISOString();
export const get = async (sql, ...args) => (await query(sql, args)).rows[0];
export const all = async (sql, ...args) => (await query(sql, args)).rows;
export const run = async (sql, ...args) => ({ changes: (await query(sql, args)).rowCount });
export async function transaction(fn) {
  if (context.getStore()) return fn();
  if (postgres) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await context.run(client, fn);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
  return locked(async () => {
    sqlite.exec('BEGIN');
    try {
      const result = await context.run(sqlite, fn);
      sqlite.exec('COMMIT');
      return result;
    } catch (e) {
      sqlite.exec('ROLLBACK');
      throw e;
    }
  });
}
export const db = {
  close: async () => {
    if (pool) await pool.end();
    else sqlite.close();
  },
};
if (postgres) {
  pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 3,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 20000,
    allowExitOnIdle: true,
  });
  pool.on('error', (e) => console.error('Database connection error:', e.message));
  await transaction(async () => {
    await context.getStore().query('SELECT pg_advisory_xact_lock(92451478)');
    await context
      .getStore()
      .query(
        'CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
      );
    for (const name of ['001_initial', '002_public_links', '003_cloud_sync']) {
      if (await get('SELECT name FROM migrations WHERE name=?', name)) continue;
      let sql = readFileSync(new URL('./migrations/' + name + '.sql', import.meta.url), 'utf8');
      sql = sql
        .replaceAll('expires INTEGER', 'expires BIGINT')
        .replaceAll('position REAL', 'position DOUBLE PRECISION')
        .replaceAll('updated_at INTEGER', 'updated_at BIGINT');
      await context.getStore().query(sql);
      await run('INSERT INTO migrations VALUES (?,?)', name, now());
    }
  });
} else {
  const { DatabaseSync } = await import('node:sqlite');
  const file = resolve(process.env.DATABASE_PATH || './data/notion.sqlite');
  mkdirSync(dirname(file), { recursive: true });
  sqlite = new DatabaseSync(file);
  sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  sqlite.exec(
    'CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
  );
  for (const name of ['001_initial', '002_public_links', '003_cloud_sync']) {
    if (await get('SELECT name FROM migrations WHERE name=?', name)) continue;
    await transaction(async () => {
      sqlite.exec(readFileSync(new URL('./migrations/' + name + '.sql', import.meta.url), 'utf8'));
      await run('INSERT INTO migrations VALUES (?,?)', name, now());
    });
  }
}
export async function createWorkspace(user, name) {
  const id = uid();
  await run('INSERT INTO workspaces VALUES (?,?,?,?)', id, name, user.id, now());
  await run('INSERT INTO members VALUES (?,?,?)', id, user.id, 'owner');
  return id;
}
export async function insertPage(user, workspace, data = {}) {
  const id = uid(),
    time = now();
  const owner = data.parent_id
    ? (await get('SELECT owner_id FROM pages WHERE id=?', data.parent_id))?.owner_id || user.id
    : user.id;
  const config =
    data.kind === 'database'
      ? {
          properties: [
            {
              id: 'status',
              name: 'Status',
              type: 'select',
              options: ['Not started', 'In progress', 'Done'],
            },
            { id: 'date', name: 'Due date', type: 'date' },
          ],
          views: [{ id: uid(), name: 'Table', type: 'table', filter: '', sort: 'manual' }],
        }
      : {};
  await run(
    'INSERT INTO pages (id,workspace_id,parent_id,owner_id,title,icon,kind,visibility,position,config,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    id,
    workspace,
    data.parent_id || null,
    owner,
    data.title || '',
    data.icon || '',
    data.kind || 'page',
    data.visibility || 'private',
    Date.now(),
    JSON.stringify(config),
    time,
    time,
  );
  if (data.kind !== 'database')
    await run('INSERT INTO blocks (id,page_id,position) VALUES (?,?,?)', uid(), id, 0);
  return id;
}
