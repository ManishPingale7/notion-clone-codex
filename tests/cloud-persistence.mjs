import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// A retained session and page prove persistence across an actual redeployment.
const base = process.env.PLAYWRIGHT_BASE_URL;
if (!base) throw new Error('Set PLAYWRIGHT_BASE_URL to the deployment to test.');
const file = '.hosting/cloud-proof.json';
let cookie = '';
async function request(path, method = 'GET', body) {
  const response = await fetch(base + '/api' + path, {
    method,
    headers: { cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const session = response.headers.get('set-cookie');
  if (session) cookie = session.split(';')[0];
  return { status: response.status, data: await response.json() };
}
if (process.argv.includes('--verify')) {
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(saved.base, base);
  cookie = saved.cookie;
  assert.equal((await request('/me')).status, 200);
  const page = await request('/pages/' + saved.page);
  assert.equal(page.status, 200);
  assert.equal(page.data.blocks.find((b) => b.id === saved.block).html, saved.html);
  console.log('PASS: authenticated session and saved block survived deployment.');
} else {
  const id = randomUUID();
  assert.equal(
    (
      await request('/auth/register', 'POST', {
        name: 'Cloud persistence check',
        email: `cloud-${id}@example.com`,
        password: randomUUID(),
      })
    ).status,
    201,
  );
  const workspace = (await request('/workspaces')).data[0].id;
  const page = (
    await request('/pages', 'POST', {
      workspace_id: workspace,
      title: 'Deployment persistence verification',
    })
  ).data;
  const block = (await request('/pages/' + page.id)).data.blocks[0];
  const outcomes = await Promise.all(
    ['First saved text', 'Second saved text'].map((html) =>
      request(`/pages/${page.id}/blocks/${block.id}`, 'PATCH', { revision: block.revision, html }),
    ),
  );
  assert.deepEqual(outcomes.map((r) => r.status).sort(), [200, 409]);
  const saved = (await request('/pages/' + page.id)).data.blocks[0];
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({ base, cookie, page: page.id, block: block.id, html: saved.html }),
  );
  console.log(
    'PASS: cloud concurrent writes yield one success and one conflict; persistence checkpoint stored locally (ignored by Git).',
  );
}
