import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = relative => readFile(new URL(`../${relative}`, import.meta.url), 'utf8');

test('team APIs verify Cloudflare Access JWTs and keep emergency-key fallback', async () => {
  const source = await read('src/middleware/team-auth.ts');
  assert.match(source, /Cf-Access-Jwt-Assertion/i);
  assert.match(source, /POLICY_AUD/);
  assert.match(source, /crypto\.subtle\.verify/);
  assert.match(source, /X-Team-Key/);
});

test('dashboard no longer asks members for a team key', async () => {
  const html = await read('public/index.html');
  assert.doesNotMatch(html, /请输入团队访问密钥|X-Team-Key|localStorage\.setItem\(['"]eco_team_access_key_v1/);
  assert.match(html, /Cloudflare Access/);
});

test('adding a member relies on the Access email and does not create invite secrets', async () => {
  const source = await read('src/api/collaboration.ts');
  assert.doesNotMatch(source, /inviteKey|inviteUrl|createTeamAccessKey/);
});

test('Coze credentials stay in the Worker and are never rendered into the dashboard', async () => {
  const worker = await read('src/api/ai.ts');
  const html = await read('public/index.html');
  const config = await read('wrangler.toml');

  assert.match(worker, /env\.COZE_PAT/);
  assert.match(worker, /requireTeamMember/);
  assert.match(worker, /assertTeamSameOrigin/);
  assert.match(html, /\/api\/ai\/chat/);
  assert.match(html, /Cloudflare 安全托管/);
  assert.doesNotMatch(html, /aiCozePat|aiCozeBotId|Bearer ['"]?\+cfg\.cozePat/);
  assert.doesNotMatch(config, /COZE_PAT\s*=/);
  assert.doesNotMatch(`${worker}\n${html}\n${config}`, /pat_[A-Za-z0-9_-]{20,}/);
});
