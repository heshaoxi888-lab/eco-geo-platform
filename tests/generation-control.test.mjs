import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = relative => readFile(new URL(`../${relative}`, import.meta.url), 'utf8');

test('AI draft generation can be stopped and resumed without discarding completed drafts', async () => {
  const html = await read('public/index.html');

  assert.match(html, /function stopAIGeneration\(taskId\)/);
  assert.match(html, /function resumeAIGeneration\(taskId\)/);
  assert.match(html, /function requestStopAIGeneration\(taskId\)/);
  assert.match(html, /task\.status!=='ai_gen'\|\|task\.genState==='stopped'/);
  assert.match(html, /new AbortController\(\)/);
  assert.match(html, /err&&err\.name==='AbortError'/);
  assert.match(html, /if\(task\.drafts\[p\]\) continue/);
  assert.match(html, /已经生成的内容已保留/);
});

test('closing the drawer and stopping generation are separate actions', async () => {
  const html = await read('public/index.html');

  assert.match(html, /onclick="closeTaskDrawer\(\)" title="关闭 \(Esc\)"/);
  assert.match(html, /onclick="requestStopAIGeneration\('\$\{t\.id\}'\)"/);
  assert.match(html, /关闭此面板不会停止任务/);
});

test('projects can be terminated and restored while preserving their history', async () => {
  const html = await read('public/index.html');

  assert.match(html, /function terminateTask\(taskId\)/);
  assert.match(html, /function restoreTask\(taskId\)/);
  assert.match(html, /function requestTerminateTask\(taskId\)/);
  assert.match(html, /\{key:'terminated', name:'已终止'/);
  assert.match(html, /COLS\.filter\(c=>c\.key!=='terminated'\)/);
  assert.match(html, /t\.status!=='terminated'&&/);
  assert.match(html, /现有母稿、任务数据和操作记录均已保留/);
  assert.match(html, /终止并保留记录/);
});

test('the Worker propagates client cancellation to the Coze request', async () => {
  const source = await read('src/api/ai.ts');
  assert.match(source, /signal: request\.signal/);
});

test('drawer status never renders a missing icon as undefined', async () => {
  const html = await read('public/index.html');
  assert.match(html, /aCol&&aCol\.icon\?aCol\.icon:''/);
});
