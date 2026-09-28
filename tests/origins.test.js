import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allowedOrigin } from '../server/origins.js';

test('same-origin and non-browser requests work; unrelated origins are rejected', () => {
  assert.equal(allowedOrigin(undefined, '127.0.0.1:3000'), true);
  assert.equal(allowedOrigin('http://127.0.0.1:3000', '127.0.0.1:3000'), true);
  assert.equal(allowedOrigin('https://evil.example', '127.0.0.1:3000'), false);
  assert.equal(allowedOrigin('https://notion.example', 'notion.example', 'https'), true);
});
test('deployment origin allowlist uses exact origins, not suffixes or substrings', () => {
  const previous = process.env.ALLOWED_ORIGINS;
  process.env.ALLOWED_ORIGINS = 'https://notion-demo.vercel.app';
  try {
    assert.equal(allowedOrigin('https://notion-demo.vercel.app', '127.0.0.1:3001'), true);
    assert.equal(
      allowedOrigin('https://notion-demo.vercel.app.evil.example', '127.0.0.1:3001'),
      false,
    );
    assert.equal(allowedOrigin('http://notion-demo.vercel.app', '127.0.0.1:3001'), false);
  } finally {
    if (previous === undefined) delete process.env.ALLOWED_ORIGINS;
    else process.env.ALLOWED_ORIGINS = previous;
  }
});
test('deployment origin file reloads and malformed configuration fails closed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'notion-origins-')),
    file = join(dir, 'origins.json'),
    previous = process.env.ALLOWED_ORIGINS_FILE;
  process.env.ALLOWED_ORIGINS_FILE = file;
  try {
    writeFileSync(file, JSON.stringify(['https://first.vercel.app']));
    assert.equal(allowedOrigin('https://first.vercel.app', 'localhost'), true);
    writeFileSync(file, JSON.stringify(['https://second.vercel.app']));
    assert.equal(allowedOrigin('https://first.vercel.app', 'localhost'), false);
    assert.equal(allowedOrigin('https://second.vercel.app', 'localhost'), true);
    writeFileSync(file, 'broken');
    assert.equal(allowedOrigin('https://second.vercel.app', 'localhost'), false);
  } finally {
    if (previous === undefined) delete process.env.ALLOWED_ORIGINS_FILE;
    else process.env.ALLOWED_ORIGINS_FILE = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
