// Plain-node test of the HTTP bridge and hook.js (no Electron needed).
const assert = require('assert');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { createServer, summarizeTool } = require('../server');

const PORT = 47999;
const events = [];
const bridge = createServer({
  port: PORT,
  onNotify: (a) => events.push(['notify', a]),
  onClaudeActivity: (a) => events.push(['activity', a]),
  onClaudeDone: (a) => events.push(['done', a]),
  onPermission: (p) => {
    events.push(['permission', p]);
    if (!p.cancel) setTimeout(() => bridge.resolvePermission(p.id, process.env.TEST_DECISION || 'allow'), 100);
  },
});

const post = (url, body) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port: PORT, path: url, method: 'POST', headers: { 'Content-Type': 'application/json' } },
    (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve(JSON.parse(d || '{}'))); });
  r.on('error', reject); r.end(JSON.stringify(body));
});

const runHook = (payload) => new Promise((resolve) => {
  const p = spawn(process.execPath, [path.join(__dirname, '..', 'hook.js')], { env: { ...process.env, ISLET_PORT: PORT } });
  let out = ''; p.stdout.on('data', (c) => (out += c));
  p.on('close', (code) => resolve({ code, out }));
  p.stdin.end(JSON.stringify(payload));
});

(async () => {
  await bridge.listen();

  // summaries
  assert.strictEqual(summarizeTool('Edit', { file_path: 'C:\\proj\\src\\app.js' }), 'Editing app.js');
  assert.strictEqual(summarizeTool('Bash', { command: 'npm test\nmore' }), 'Running npm test');

  // notify
  await post('/notify', { title: 'Hi', body: 'There', icon: '🔥', duration: 100 });
  assert.deepStrictEqual(events.shift()[1], { title: 'Hi', body: 'There', icon: '🔥', duration: 1500 }); // clamped to 1500

  // activity + done + notification
  await post('/claude', { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/a/b/c.py' }, cwd: '/a/b' });
  assert.strictEqual(events.shift()[1].text, 'Reading c.py');
  await post('/claude', { hook_event_name: 'Stop', cwd: '/a/b' });
  assert.strictEqual(events.shift()[0], 'done');
  await post('/claude', { hook_event_name: 'Notification', message: 'Claude needs input', cwd: '/a/b' });
  assert.strictEqual(events.shift()[1].body, 'Claude needs input');

  // permission via the real hook.js: allow
  let r = await runHook({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'rm -rf build' }, cwd: '/a/b' });
  assert.strictEqual(r.code, 0);
  assert.deepStrictEqual(JSON.parse(r.out), { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
  assert.strictEqual(events.shift()[1].action, 'Running rm -rf build');

  // permission: deny
  process.env.TEST_DECISION = 'deny';
  r = await runHook({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'x' }, cwd: '/a/b' });
  assert.strictEqual(JSON.parse(r.out).hookSpecificOutput.decision.behavior, 'deny');
  events.length = 0;

  // hook with island closed -> silent, exit 0, fast
  bridge.close();
  const t0 = Date.now();
  r = await runHook({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {} });
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.out, '');
  assert.ok(Date.now() - t0 < 1500, 'hook should fail fast when Islet is not running');

  console.log('all server/hook tests passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
