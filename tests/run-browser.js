import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'notion-browser-'));
const env = {
  ...process.env,
  DATABASE_URL: '',
  PORT: '3101',
  DATABASE_PATH: join(dir, 'browser.sqlite'),
  NOTION_TEST_SERVER: '1',
};
const server = spawn(process.execPath, ['server/index.js', '--production'], {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
server.stdout.on('data', (x) => (output += x));
server.stderr.on('data', (x) => (output += x));
let exitCode = 1;
try {
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(output);
    try {
      const r = await fetch('http://127.0.0.1:3101/api/me');
      if (r.status === 401) break;
    } catch {}
    if (i === 99) throw new Error('Test server did not start: ' + output);
    await new Promise((r) => setTimeout(r, 100));
  }
  const child = spawn(
    process.execPath,
    ['node_modules/@playwright/test/cli.js', 'test', ...process.argv.slice(2)],
    { env, stdio: 'inherit' },
  );
  exitCode = await new Promise((resolve) => child.on('exit', (code) => resolve(code ?? 1)));
} catch (e) {
  console.error(e.message);
} finally {
  if (server.exitCode === null) {
    const exited = new Promise((resolve) => server.once('exit', resolve));
    server.kill();
    await exited;
  }
  rmSync(dir, { recursive: true, force: true });
}
process.exitCode = exitCode;
