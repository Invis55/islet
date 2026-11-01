'use strict';
// Minimal, dependency-free .ics reader: VEVENT, RRULE (DAILY/WEEKLY/MONTHLY/YEARLY with
// INTERVAL, COUNT, UNTIL, BYDAY incl. 2TU/-1FR, BYMONTHDAY, BYMONTH), EXDATE, RECURRENCE-ID
// overrides, TZID (IANA and common Windows names), all-day events, and Meet/Zoom/Teams links.

const DAY = 86400000;
const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

const WIN_TZ = {
  'Pakistan Standard Time': 'Asia/Karachi', 'India Standard Time': 'Asia/Kolkata', 'GMT Standard Time': 'Europe/London',
  'W. Europe Standard Time': 'Europe/Berlin', 'Central Europe Standard Time': 'Europe/Budapest', 'Romance Standard Time': 'Europe/Paris',
  'Central European Standard Time': 'Europe/Warsaw', 'E. Europe Standard Time': 'Europe/Chisinau', 'GTB Standard Time': 'Europe/Bucharest',
  'Eastern Standard Time': 'America/New_York', 'Central Standard Time': 'America/Chicago', 'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles', 'US Eastern Standard Time': 'America/Indianapolis', 'Atlantic Standard Time': 'America/Halifax',
  'Canada Central Standard Time': 'America/Regina', 'Alaskan Standard Time': 'America/Anchorage', 'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Arabian Standard Time': 'Asia/Dubai', 'Arab Standard Time': 'Asia/Riyadh', 'Arabic Standard Time': 'Asia/Baghdad',
  'Turkey Standard Time': 'Europe/Istanbul', 'Russian Standard Time': 'Europe/Moscow', 'Israel Standard Time': 'Asia/Jerusalem',
  'Iran Standard Time': 'Asia/Tehran', 'Central Asia Standard Time': 'Asia/Almaty', 'Bangladesh Standard Time': 'Asia/Dhaka',
  'SE Asia Standard Time': 'Asia/Bangkok', 'China Standard Time': 'Asia/Shanghai', 'Singapore Standard Time': 'Asia/Singapore',
  'Tokyo Standard Time': 'Asia/Tokyo', 'Korea Standard Time': 'Asia/Seoul', 'AUS Eastern Standard Time': 'Australia/Sydney',
  'New Zealand Standard Time': 'Pacific/Auckland', 'Egypt Standard Time': 'Africa/Cairo', 'South Africa Standard Time': 'Africa/Johannesburg',
  'W. Central Africa Standard Time': 'Africa/Lagos', 'E. Africa Standard Time': 'Africa/Nairobi', 'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'UTC': 'UTC', 'Coordinated Universal Time': 'UTC',
};

/* ---------- parsing ---------- */
function splitUnquoted(s, sep) {
  const parts = []; let cur = ''; let q = false;
  for (const c of s) {
    if (c === '"') q = !q;
    if (c === sep && !q) { parts.push(cur); cur = ''; } else cur += c;
  }
  parts.push(cur);
  return parts;
}

function parseLine(line) {
  let q = false, idx = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') q = !q; else if (c === ':' && !q) { idx = i; break; }
  }
  if (idx < 0) return null;
  const parts = splitUnquoted(line.slice(0, idx), ';');
  const name = parts.shift().toUpperCase();
  const params = {};
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name, params, value: line.slice(idx + 1) };
}

function parseVEvents(text) {
  const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const events = [];
  let cur = null, depth = 0;
  for (const raw of lines) {
    if (!raw) continue;
    const p = parseLine(raw);
    if (!p) continue;
    if (p.name === 'BEGIN') {
      if (p.value === 'VEVENT') { cur = { props: {}, exdates: [] }; depth = 0; } else if (cur) depth++;
      continue;
    }
    if (p.name === 'END') {
      if (p.value === 'VEVENT') { if (cur) events.push(cur); cur = null; } else if (cur) depth--;
      continue;
    }
    if (!cur || depth > 0) continue; // ignore VALARM etc.
    if (p.name === 'EXDATE') { cur.exdates.push(p); continue; }
    if (!(p.name in cur.props)) cur.props[p.name] = p;
  }
  return events;
}

const unescapeText = (s) => String(s || '').replace(/\\[nN]/g, '\n').replace(/\\([,;\\])/g, '$1');

/* ---------- time zones ---------- */
const dtfCache = new Map();
function resolveTz(name) {
  if (!name) return null;
  name = name.replace(/^"|"$/g, '');
  if (WIN_TZ[name]) name = WIN_TZ[name];
  try { new Intl.DateTimeFormat('en-US', { timeZone: name }); return name; } catch { return null; }
}
function tzOffsetMs(utcMs, tz) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit' });
    dtfCache.set(tz, f);
  }
  const o = {};
  for (const p of f.formatToParts(new Date(utcMs))) o[p.type] = p.value;
  return Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour % 24, +o.minute, +o.second) - Math.floor(utcMs / 1000) * 1000;
}
// "wall" = wall-clock fields stored as if they were UTC. Convert to a real instant for a zone.
function wallToUtc(wall, tz) {
  if (tz === 'UTC') return wall;
  const t = wall - tzOffsetMs(wall, tz);
  return wall - tzOffsetMs(t, tz);
}

function parseDateValue(prop) {
  const m = String(prop.value).trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  if (m[4] === undefined) return { wall, tz: LOCAL_TZ, allDay: true };
  if (m[7]) return { wall, tz: 'UTC', allDay: false };
  return { wall, tz: resolveTz(prop.params && prop.params.TZID) || LOCAL_TZ, allDay: false };
}

function parseDuration(v) {
  const m = String(v).match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return 0;
  const ms = ((+m[2] || 0) * 7 + (+m[3] || 0)) * DAY + (+m[4] || 0) * 3600000 + (+m[5] || 0) * 60000 + (+m[6] || 0) * 1000;
  return m[1] === '-' ? -ms : ms;
}

/* ---------- recurrence ---------- */
const WKDAY = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
function parseRule(v) {
  const r = {};
  for (const part of String(v).split(';')) { const [k, val] = part.split('='); if (k) r[k.toUpperCase()] = val; }
  return r;
}
function parseByDay(s) {
  if (!s) return null;
  return s.split(',').map((t) => {
    const m = t.trim().match(/^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/);
    return m ? { n: m[1] ? +m[1] : 0, dow: WKDAY[m[2]] } : null;
  }).filter(Boolean);
}
function monthDays(y, m, byday, bymd, sdate) {
  const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  let days;
  if (byday) {
    days = [];
    for (const b of byday) {
      const matches = [];
      for (let d = 1; d <= dim; d++) if (new Date(Date.UTC(y, m, d)).getUTCDay() === b.dow) matches.push(d);
      if (!b.n) days.push(...matches);
      else { const i = b.n > 0 ? b.n - 1 : matches.length + b.n; if (matches[i]) days.push(matches[i]); }
    }
    if (bymd) { const set = new Set(bymd.map((d) => (d > 0 ? d : dim + d + 1))); days = days.filter((d) => set.has(d)); }
  } else if (bymd) {
    days = bymd.map((d) => (d > 0 ? d : dim + d + 1)).filter((d) => d >= 1 && d <= dim);
  } else {
    days = sdate <= dim ? [sdate] : [];
  }
  return [...new Set(days)].sort((a, b) => a - b);
}

function* walls(rule, startWall) {
  const interval = Math.max(1, +rule.INTERVAL || 1);
  const startDay = Math.floor(startWall / DAY) * DAY;
  const tod = startWall - startDay;
  const sd = new Date(startDay);
  const sy = sd.getUTCFullYear(), sm = sd.getUTCMonth(), sdate = sd.getUTCDate(), sdow = sd.getUTCDay();
  const byday = parseByDay(rule.BYDAY);
  const bymd = rule.BYMONTHDAY ? rule.BYMONTHDAY.split(',').map(Number) : null;
  const bymonth = rule.BYMONTH ? rule.BYMONTH.split(',').map(Number) : null;

  if (rule.FREQ === 'DAILY') {
    for (let i = 0; ; i++) {
      const day = startDay + i * interval * DAY;
      const d = new Date(day);
      if (byday && !byday.some((b) => b.dow === d.getUTCDay())) continue;
      if (bymonth && !bymonth.includes(d.getUTCMonth() + 1)) continue;
      yield day + tod;
    }
  } else if (rule.FREQ === 'WEEKLY') {
    const wk = rule.WKST && WKDAY[rule.WKST] !== undefined ? WKDAY[rule.WKST] : 1;
    const w0 = startDay - ((sdow - wk + 7) % 7) * DAY;
    for (let i = 0; ; i++) {
      const ws = w0 + i * interval * 7 * DAY;
      for (let d = 0; d < 7; d++) {
        const day = ws + d * DAY;
        if (day < startDay) continue;
        const dow = new Date(day).getUTCDay();
        if (byday ? byday.some((b) => b.dow === dow) : dow === sdow) yield day + tod;
      }
    }
  } else if (rule.FREQ === 'MONTHLY') {
    for (let i = 0; ; i++) {
      const idx = sm + i * interval;
      const y = sy + Math.floor(idx / 12), m = ((idx % 12) + 12) % 12;
      for (const d of monthDays(y, m, byday, bymd, sdate)) { const w = Date.UTC(y, m, d) + tod; if (w >= startWall) yield w; }
    }
  } else if (rule.FREQ === 'YEARLY') {
    for (let i = 0; ; i++) {
      const y = sy + i * interval;
      const months = bymonth ? bymonth.map((x) => x - 1).sort((a, b) => a - b) : [sm];
      for (const m of months) for (const d of monthDays(y, m, byday, bymd, sdate)) { const w = Date.UTC(y, m, d) + tod; if (w >= startWall) yield w; }
    }
  } else {
    yield startWall;
  }
}

/* ---------- join links ---------- */
const JOIN_RES = [
  /https:\/\/meet\.google\.com\/[a-z0-9][a-z0-9\-_?=&%.]*/i,
  /https:\/\/[\w.-]*zoom\.(?:us|com)\/(?:j|my|s|wc\/join)\/[^\s<>"')\]\\]+/i,
  /https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s<>"')\]\\]+/i,
  /https:\/\/teams\.live\.com\/meet\/[^\s<>"')\]\\]+/i,
  /https:\/\/[\w.-]*webex\.com\/(?:meet|join|[\w.-]+\/j\.php)[^\s<>"')\]\\]*/i,
];
function unwrapSafelinks(s) {
  return s.replace(/https:\/\/[a-z0-9.-]*safelinks\.protection\.outlook\.com\/\?[^\s<>"']*/gi, (m) => {
    try { return new URL(m.replace(/&amp;/g, '&')).searchParams.get('url') || m; } catch { return m; }
  });
}
function findJoinLink(...texts) {
  for (const t of texts) {
    if (!t) continue;
    const s = unwrapSafelinks(String(t));
    for (const re of JOIN_RES) {
      const m = s.match(re);
      if (m) return m[0].replace(/[).,;&]+$/, '');
    }
  }
  return null;
}
const JOIN_HOSTS = /^(?:meet\.google\.com|(?:[\w-]+\.)*zoom\.(?:us|com)|teams\.microsoft\.com|teams\.live\.com|(?:[\w-]+\.)*webex\.com)$/i;
function isAllowedJoinUrl(u) {
  try { const x = new URL(u); return x.protocol === 'https:' && JOIN_HOSTS.test(x.hostname); } catch { return false; }
}

/* ---------- main entry ---------- */
function collect(text, now = new Date(), days = 7) {
  const d0 = new Date(now); d0.setHours(0, 0, 0, 0);
  const from = d0.getTime(), to = from + days * DAY;
  const vevents = parseVEvents(text);
  const uidOf = (ev) => (ev.props.UID ? ev.props.UID.value : '');

  const overridden = new Set();
  for (const ev of vevents) {
    if (ev.props['RECURRENCE-ID']) {
      const r = parseDateValue(ev.props['RECURRENCE-ID']);
      if (r) overridden.add(`${uidOf(ev)}|${wallToUtc(r.wall, r.tz)}`);
    }
  }

  const out = [], seen = new Set();
  for (const ev of vevents) {
    const P = ev.props;
    if (!P.DTSTART) continue;
    const s = parseDateValue(P.DTSTART);
    if (!s) continue;
    if (String((P.STATUS && P.STATUS.value) || '').toUpperCase() === 'CANCELLED') continue;

    const startUtc0 = wallToUtc(s.wall, s.tz);
    let durMs = 0;
    if (P.DTEND) { const e = parseDateValue(P.DTEND); if (e) durMs = wallToUtc(e.wall, e.tz) - startUtc0; }
    else if (P.DURATION) durMs = parseDuration(P.DURATION.value);
    else if (s.allDay) durMs = DAY;
    if (s.allDay && durMs < DAY) durMs = DAY;
    const durDays = Math.round(durMs / DAY);

    const title = unescapeText(P.SUMMARY && P.SUMMARY.value).trim() || '(no title)';
    const location = unescapeText(P.LOCATION && P.LOCATION.value).trim();
    const join = findJoinLink(
      P['X-GOOGLE-CONFERENCE'] && P['X-GOOGLE-CONFERENCE'].value,
      P['X-MICROSOFT-SKYPETEAMSMEETINGURL'] && P['X-MICROSOFT-SKYPETEAMSMEETINGURL'].value,
      P['X-MICROSOFT-ONLINEMEETINGEXTERNALLINK'] && P['X-MICROSOFT-ONLINEMEETINGEXTERNALLINK'].value,
      unescapeText(P.LOCATION && P.LOCATION.value),
      unescapeText(P.DESCRIPTION && P.DESCRIPTION.value),
      P.URL && P.URL.value,
    );
    const uid = uidOf(ev);
    const add = (sUtc, eUtc) => {
      if (!(sUtc < to && (eUtc > from || (eUtc === sUtc && sUtc >= from)))) return;
      const id = `${uid}:${sUtc}`;
      if (seen.has(id)) return;
      seen.add(id);
      out.push({ id, title, start: sUtc, end: eUtc, allDay: s.allDay, location, join });
    };
    const endFor = (wall, sUtc) => (s.allDay ? wallToUtc(wall + durDays * DAY, s.tz) : sUtc + durMs);

    if (!P.RRULE || P['RECURRENCE-ID']) { add(startUtc0, endFor(s.wall, startUtc0)); continue; }

    const rule = parseRule(P.RRULE.value);
    const ex = new Set();
    for (const p of ev.exdates) for (const v of p.value.split(',')) {
      const d = parseDateValue({ value: v, params: p.params });
      if (d) ex.add(wallToUtc(d.wall, d.tz));
    }
    let until = Infinity;
    if (rule.UNTIL) {
      const u = parseDateValue({ value: rule.UNTIL, params: {} });
      if (u) until = u.allDay ? wallToUtc(u.wall + DAY - 1, s.tz) : u.tz === 'UTC' ? u.wall : wallToUtc(u.wall, s.tz);
    }
    const max = rule.COUNT ? +rule.COUNT : Infinity;
    let n = 0, guard = 0;
    for (const wall of walls(rule, s.wall)) {
      if (++guard > 20000) break;
      const sUtc = wallToUtc(wall, s.tz);
      if (sUtc > until) break;
      if (++n > max) break;
      if (sUtc >= to) break;
      if (ex.has(sUtc) || overridden.has(`${uid}|${sUtc}`)) continue;
      add(sUtc, endFor(wall, sUtc));
    }
  }
  out.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
  return out;
}

const normalizeUrl = (u) => String(u || '').trim().replace(/^webcal:/i, 'https:');

async function loadEvents(url, { fetchFn = globalThis.fetch, now = new Date(), days = 7 } = {}) {
  const u = normalizeUrl(url);
  if (!/^https?:\/\//i.test(u)) throw new Error('The calendar link should start with https:// or webcal://');
  const res = await fetchFn(u, { headers: { 'User-Agent': 'Islet' }, signal: AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined });
  if (!res.ok) throw new Error(`Calendar server answered ${res.status}`);
  const text = await res.text();
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error("That link didn't return a calendar (.ics) file");
  return collect(text, now, days);
}

module.exports = { collect, loadEvents, findJoinLink, isAllowedJoinUrl, normalizeUrl, parseVEvents };
