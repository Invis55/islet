'use strict';
// Adds / removes Islet's hooks in Claude Code's settings.json without disturbing anything else in it.
const fs = require('fs');
const os = require('os');
const path = require('path');

const EVENTS = [
  ['UserPromptSubmit', {}],
  ['PreToolUse', { matcher: '*' }],
  ['Notification', {}],
  ['Stop', {}],
  ['PermissionRequest', { matcher: '*', timeout: 100 }],
];

const isOurs = (cmd) => /islet.*hook\.(ps1|js)/i.test(String(cmd || ''));
const groupIsOurs = (g) => Array.isArray(g && g.hooks) && g.hooks.some((h) => isOurs(h.command));

// PowerShell ships with Windows, so the installed app doesn't need Node.js for this.
function commandFor(hookPath) {
  return `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${hookPath.replace(/\\/g, '/')}"`;
}

function mergeHooks(settings, command) {
  const out = JSON.parse(JSON.stringify(settings || {}));
  if (!out.hooks || typeof out.hooks !== 'object') out.hooks = {};
  for (const [ev, opts] of EVENTS) {
    const groups = (Array.isArray(out.hooks[ev]) ? out.hooks[ev] : []).filter((g) => !groupIsOurs(g));
    const hook = { type: 'command', command };
    if (opts.timeout) hook.timeout = opts.timeout;
    const group = { hooks: [hook] };
    if (opts.matcher) group.matcher = opts.matcher;
    out.hooks[ev] = [...groups, group];
  }
  return out;
}

function removeHooks(settings) {
  const out = JSON.parse(JSON.stringify(settings || {}));
  if (!out.hooks) return out;
  for (const ev of Object.keys(out.hooks)) {
    if (!Array.isArray(out.hooks[ev])) continue;
    out.hooks[ev] = out.hooks[ev].filter((g) => !groupIsOurs(g));
    if (!out.hooks[ev].length) delete out.hooks[ev];
  }
  if (!Object.keys(out.hooks).length) delete out.hooks;
  return out;
}

const isConnected = (settings) => EVENTS.every(([ev]) => ((settings && settings.hooks && settings.hooks[ev]) || []).some(groupIsOurs));

const settingsPath = () => path.join(os.homedir(), '.claude', 'settings.json');

function read(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return { settings: {}, existed: false }; throw e; }
  if (!text.trim()) return { settings: {}, existed: true };
  try { return { settings: JSON.parse(text), existed: true }; } catch {
    throw new Error(`${file} isn't valid JSON, so I left it untouched. Fix or delete it, then try again.`);
  }
}

function write(file, obj, existed) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (existed) { const bak = `${file}.islet-backup`; if (!fs.existsSync(bak)) fs.copyFileSync(file, bak); }
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(`${file}.tmp`, file);
}

function status(file = settingsPath()) {
  try { return { connected: isConnected(read(file).settings), file }; } catch (e) { return { connected: false, file, error: e.message }; }
}
function connect(file, hookPath) {
  const { settings, existed } = read(file);
  write(file, mergeHooks(settings, commandFor(hookPath)), existed);
}
function disconnect(file) {
  const { settings, existed } = read(file);
  if (existed) write(file, removeHooks(settings), true);
}

module.exports = { mergeHooks, removeHooks, isConnected, commandFor, settingsPath, status, connect, disconnect };
