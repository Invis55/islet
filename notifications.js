'use strict';
// Parses rows coming out of notifications.ps1 (toast XML -> title/body, app id -> friendly name).
const path = require('path');

const ENT = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&amp;': '&' };
function decodeXml(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&(?:lt|gt|quot|apos|amp);/g, (m) => ENT[m]);
}

function parseToast(xml) {
  const texts = [];
  for (const m of String(xml || '').matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/gi)) {
    if (/placement\s*=\s*["']attribution["']/i.test(m[1])) continue;
    const t = decodeXml(m[2].replace(/<[^>]+>/g, '')).trim();
    if (t) texts.push(t);
  }
  return { title: texts[0] || '', body: texts.slice(1).join('\n') };
}

const KNOWN = [
  [/whatsapp/i, 'WhatsApp', '💬'], [/telegram/i, 'Telegram', '✈️'], [/signal/i, 'Signal', '💬'],
  [/outlook|windowscommunicationsapps|microsoft\.office\.outlook/i, 'Mail', '✉️'], [/gmail|thunderbird|mailspring/i, 'Mail', '✉️'],
  [/msteams|teams/i, 'Teams', '👥'], [/slack/i, 'Slack', '💼'], [/discord/i, 'Discord', '🎮'], [/zoom/i, 'Zoom', '📹'],
  [/spotify/i, 'Spotify', '🎵'], [/chrome|msedge|firefox|brave|opera/i, 'Browser', '🌐'],
  [/securityandmaintenance|windows\.systemtoast|windowsdefender|security/i, 'Windows', '🛡️'],
  [/calendar|reminder/i, 'Calendar', '📅'], [/instagram|facebook|messenger|twitter|linkedin/i, 'Social', '👤'],
];

function friendlyApp(id) {
  const raw = String(id || '');
  for (const [re, name, icon] of KNOWN) if (re.test(raw)) return { name, icon };
  // "5319275A.SomeApp_8wekyb3d8bbwe!App" -> "SomeApp"
  const pkg = raw.split('!')[0].split('_')[0];
  let name = pkg.split('.').filter((p) => !/^[0-9A-F]{8}$/i.test(p)).pop() || pkg || 'App';
  name = path.basename(name).replace(/\.exe$/i, '').replace(/([a-z])([A-Z])/g, '$1 $2');
  return { name: name.charAt(0).toUpperCase() + name.slice(1), icon: '🔔' };
}

// rows: [{id, t, app, payload}] from the PowerShell script -> UI items (newest first)
function toItems(rows) {
  const out = [];
  for (const r of rows || []) {
    const { title, body } = parseToast(r.payload);
    if (!title && !body) continue;
    const app = friendlyApp(r.app);
    out.push({ id: r.id, t: r.t, app: app.name, icon: app.icon, title, body });
  }
  return out.sort((a, b) => b.t - a.t);
}

module.exports = { parseToast, friendlyApp, toItems, decodeXml };
