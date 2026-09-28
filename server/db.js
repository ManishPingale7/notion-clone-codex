import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
const file = resolve(process.env.DATABASE_PATH || './data/notion.sqlite');
mkdirSync(dirname(file), { recursive: true });
export const db = new DatabaseSync(file);
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
db.exec('CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
if (!db.prepare('SELECT name FROM migrations WHERE name=?').get('001_initial')) {
  db.exec('BEGIN');
  try {
    db.exec(readFileSync(new URL('./migrations/001_initial.sql', import.meta.url), 'utf8'));
    db.prepare('INSERT INTO migrations VALUES (?,?)').run('001_initial', new Date().toISOString());
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
if (!db.prepare('SELECT name FROM migrations WHERE name=?').get('002_public_links')) {
  db.exec('BEGIN');
  try {
    db.exec(readFileSync(new URL('./migrations/002_public_links.sql', import.meta.url), 'utf8'));
    db.prepare('INSERT INTO migrations VALUES (?,?)').run(
      '002_public_links',
      new Date().toISOString(),
    );
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
export const uid = () => randomUUID();
export const now = () => new Date().toISOString();
export const get = (sql, ...args) => db.prepare(sql).get(...args);
export const all = (sql, ...args) => db.prepare(sql).all(...args);
export const run = (sql, ...args) => db.prepare(sql).run(...args);
export function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
export function createWorkspace(user, name) {
  const id = uid();
  run('INSERT INTO workspaces VALUES (?,?,?,?)', id, name, user.id, now());
  run('INSERT INTO members VALUES (?,?,?)', id, user.id, 'owner');
  return id;
}
export function insertPage(user, workspace, data = {}) {
  const id = uid(),
    time = now();
  const owner = data.parent_id
    ? get('SELECT owner_id FROM pages WHERE id=?', data.parent_id)?.owner_id || user.id
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
  run(
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
    run('INSERT INTO blocks (id,page_id,position) VALUES (?,?,?)', uid(), id, 0);
  return id;
}
