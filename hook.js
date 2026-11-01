#!/usr/bin/env node
// Claude Code hook -> Islet bridge. Reads the hook JSON on stdin, forwards it to the
// local Islet server, and (for PermissionRequest) prints Claude Code's decision JSON.
// If Islet isn't running this exits silently so Claude Code is never blocked.
const http = require('http');

const PORT = process.env.ISLET_PORT || 47615;
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  let ev = {};
  try { ev = JSON.parse(input); } catch { /* ignore */ }
  const isPermission = ev.hook_event_name === 'PermissionRequest';

  const req = http.request(
    { host: '127.0.0.1', port: PORT, path: '/claude', method: 'POST', headers: { 'Content-Type': 'application/json' },
      timeout: isPermission ? 95_000 : 1500 },
    (res) => {
      let out = '';
      res.on('data', (c) => (out += c));
      res.on('end', () => {
        if (isPermission) {
          try {
            const { decision } = JSON.parse(out);
            if (decision === 'allow') {
              process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } }));
            } else if (decision === 'deny') {
              process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'Denied from Islet' } } }));
            }
            // 'none' -> print nothing, Claude Code shows its normal prompt
          } catch { /* ignore */ }
        }
        process.exit(0);
      });
    }
  );
  req.on('timeout', () => { req.destroy(); });
  req.on('error', () => process.exit(0));
  req.on('close', () => process.exit(0));
  req.end(input || '{}');
});
