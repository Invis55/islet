const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('../claudehooks');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'islet-claude-'));
const file = path.join(dir, '.claude', 'settings.json');
const HOOK = 'C:\\Users\\intel\\AppData\\Local\\Programs\\Islet\\resources\\app\\hook.ps1';

// 1. no settings file yet -> created
assert.deepStrictEqual(H.status(file).connected, false);
H.connect(file, HOOK);
let s = JSON.parse(fs.readFileSync(file, 'utf8'));
assert.ok(H.isConnected(s));
assert.deepStrictEqual(Object.keys(s.hooks).sort(), ['Notification', 'PermissionRequest', 'PreToolUse', 'Stop', 'UserPromptSubmit']);
assert.strictEqual(s.hooks.PermissionRequest[0].hooks[0].timeout, 100);
assert.ok(s.hooks.PreToolUse[0].hooks[0].command.includes('C:/Users/intel/AppData/Local/Programs/Islet/resources/app/hook.ps1'), 'forward slashes, shell-agnostic');
assert.ok(H.status(file).connected);

// 2. idempotent, and upgrades the path instead of duplicating
H.connect(file, 'D:\\new\\islet\\hook.ps1');
s = JSON.parse(fs.readFileSync(file, 'utf8'));
assert.strictEqual(s.hooks.Stop.length, 1);
assert.ok(s.hooks.Stop[0].hooks[0].command.includes('D:/new/islet/hook.ps1'));

// 3. existing user settings and other hooks are preserved, backup is written once
fs.writeFileSync(file, JSON.stringify({
  model: 'opus', permissions: { allow: ['Bash(npm test)'] },
  hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo done >> log.txt' }] }], PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'prettier --write' }] }] },
}, null, 2));
H.connect(file, HOOK);
s = JSON.parse(fs.readFileSync(file, 'utf8'));
assert.strictEqual(s.model, 'opus'); assert.deepStrictEqual(s.permissions.allow, ['Bash(npm test)']);
assert.strictEqual(s.hooks.Stop.length, 2); assert.strictEqual(s.hooks.Stop[0].hooks[0].command, 'echo done >> log.txt');
assert.strictEqual(s.hooks.PostToolUse.length, 1);
const bak = JSON.parse(fs.readFileSync(file + '.islet-backup', 'utf8'));
assert.strictEqual(bak.hooks.Stop.length, 1, 'backup holds the original');

// 4. disconnect removes only Islet's entries
H.disconnect(file);
s = JSON.parse(fs.readFileSync(file, 'utf8'));
assert.deepStrictEqual(Object.keys(s.hooks).sort(), ['PostToolUse', 'Stop']);
assert.strictEqual(s.hooks.Stop.length, 1); assert.strictEqual(s.model, 'opus');
assert.strictEqual(H.status(file).connected, false);

// 5. invalid JSON is never overwritten
fs.writeFileSync(file, '{ "model": ');
assert.throws(() => H.connect(file, HOOK), /valid JSON/);
assert.strictEqual(fs.readFileSync(file, 'utf8'), '{ "model": ');
assert.ok(H.status(file).error);

console.log('claude hooks tests passed');
