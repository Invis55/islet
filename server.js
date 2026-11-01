// Local HTTP bridge. Listens on 127.0.0.1 only.
//   POST /notify   {title, body, icon, duration}      -> pop an alert on the island
//   POST /claude   <Claude Code hook JSON>            -> activity / alerts / permission prompts
//   GET  /ping                                         -> "pong"
// Kept free of Electron imports so it can be tested with plain node.
const http = require('http');
const path = require('path');

const PERMISSION_TIMEOUT_MS = 90_000;

function summarizeTool(name, input = {}) {
  const base = (p) => (p ? path.basename(String(p).replace(/\\/g, '/')) : '');
  switch (name) {
    case 'Read': return `Reading ${base(input.file_path)}`;
    case 'Edit':
    case 'MultiEdit': return `Editing ${base(input.file_path)}`;
    case 'Write': return `Writing ${base(input.file_path)}`;
    case 'NotebookEdit': return `Editing ${base(input.notebook_path)}`;
    case 'Bash': return `Running ${String(input.command || '').split('\n')[0].slice(0, 70)}`;
    case 'Grep': return `Searching “${String(input.pattern || '').slice(0, 40)}”`;
    case 'Glob': return `Finding ${String(input.pattern || '').slice(0, 40)}`;
    case 'WebFetch': return `Fetching ${String(input.url || '').slice(0, 50)}`;
    case 'WebSearch': return `Searching web: ${String(input.query || '').slice(0, 40)}`;
    case 'Task':
    case 'Agent': return 'Running a sub-agent';
    default: return name ? `Using ${name}` : 'Working';
  }
}

const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function callbackPage(ok, message) {
  return `<!doctype html><meta charset="utf-8"><title>Islet</title><body style="margin:0;height:100vh;display:grid;place-items:center;background:#000;color:#fff;font-family:Inter,'Segoe UI',system-ui,sans-serif">
<div style="text-align:center;max-width:420px;padding:24px"><div style="font-size:44px">${ok ? '✅' : '⚠️'}</div>
<h1 style="font-size:22px;margin:10px 0 6px;letter-spacing:-.02em">${ok ? 'Spotify connected' : 'Couldn’t connect Spotify'}</h1>
<p style="color:#9a9aa0;line-height:1.5;margin:0">${esc(message)}</p></div>`;
}

function createServer({ port = 47615, onNotify, onClaudeActivity, onClaudeDone, onPermission, onSpotifyCallback }) {
  const pending = new Map(); // id -> resolve
  let nextId = 1;

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/ping') {
      res.writeHead(200).end('pong');
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/spotify/callback')) {
      const q = new URL(req.url, 'http://127.0.0.1').searchParams;
      Promise.resolve(onSpotifyCallback ? onSpotifyCallback(q) : { ok: false, message: 'Spotify isn’t set up in Islet.' })
        .then((r) => { res.writeHead(r.ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(callbackPage(r.ok, r.message)); })
        .catch((e) => { res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(callbackPage(false, e.message || 'Something went wrong')); });
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 2_000_000) req.destroy();
    });
    req.on('end', async () => {
      let body;
      try { body = raw ? JSON.parse(raw) : {}; } catch { res.writeHead(400).end('bad json'); return; }
      const json = (obj) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

      if (req.url === '/notify') {
        onNotify({
          title: String(body.title || 'Notification').slice(0, 80),
          body: String(body.body || '').slice(0, 160),
          icon: String(body.icon || '🔔').slice(0, 4),
          duration: Math.min(Math.max(Number(body.duration) || 4000, 1500), 30000),
        });
        return json({ ok: true });
      }

      if (req.url === '/claude') {
        const ev = body.hook_event_name;
        const project = body.cwd ? path.basename(String(body.cwd).replace(/\\/g, '/')) : '';
        switch (ev) {
          case 'UserPromptSubmit':
            onClaudeActivity({ text: 'Thinking…', project });
            return json({});
          case 'PreToolUse':
            onClaudeActivity({ text: summarizeTool(body.tool_name, body.tool_input), project });
            return json({});
          case 'Notification':
            onNotify({ title: project ? `Claude · ${project}` : 'Claude Code', body: String(body.message || 'Needs your attention').slice(0, 160), icon: '✳️', duration: 6000 });
            return json({});
          case 'Stop':
            onClaudeDone({ project });
            return json({});
          case 'PermissionRequest': {
            const id = nextId++;
            const decision = await new Promise((resolve) => {
              const timer = setTimeout(() => { pending.delete(id); resolve('none'); }, PERMISSION_TIMEOUT_MS);
              pending.set(id, (d) => { clearTimeout(timer); pending.delete(id); resolve(d); });
              // client (hook.js) went away before we answered, e.g. Claude Code's own prompt was answered
              res.on('close', () => { if (pending.has(id)) { clearTimeout(timer); pending.delete(id); resolve('none'); onPermission({ id, cancel: true }); } });
              onPermission({
                id,
                project,
                tool: body.tool_name || 'tool',
                detail: summarizeTool(body.tool_name, body.tool_input).replace(/^(Running|Editing|Writing|Reading) /, ''),
                action: summarizeTool(body.tool_name, body.tool_input),
              });
            });
            return json({ decision });
          }
          default:
            return json({});
        }
      }
      res.writeHead(404).end();
    });
  });

  return {
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    }),
    close: () => server.close(),
    resolvePermission: (id, decision) => { const r = pending.get(id); if (r) r(decision); },
    server,
  };
}

module.exports = { createServer, summarizeTool };
