'use strict';
// Team identity helpers shared by the football providers (ids differ between API-Football and ESPN, names mostly agree).

const ALIASES = [
  [/\bwolverhampton wanderers\b/g, 'wolves'], [/\bmunchen\b/g, 'munich'], [/\bmanchester\b/g, 'man'],
  [/\binternazionale\b/g, 'inter'], [/\bparis saint germain\b/g, 'psg'], [/\bnottm\b/g, 'nottingham'],
  [/\bbrighton and hove albion\b/g, 'brighton'], [/\batletico\b/g, 'atl'], [/\bathletic club\b/g, 'athletic'],
];

function norm(s) {
  let t = String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ');
  t = t.replace(/\b(fc|cf|afc|sc|ssc|ud|cd|fk|sk|ac|club)\b/g, ' ');
  for (const [re, to] of ALIASES) t = t.replace(re, to);
  return t.replace(/\s+/g, ' ').trim();
}

function sameName(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  return s.length >= 4 && ` ${l} `.includes(` ${s} `);
}

// fav: { id, src, name, full }   team: { id, name, full }   src: provider of the match/row being tested
function teamMatches(fav, team, src) {
  if (!fav || !team) return false;
  if (fav.src && src && fav.src === src && fav.id && String(fav.id) === String(team.id)) return true;
  return sameName(fav.full || fav.name, team.full || team.name);
}

const ABBR = [
  ['arsenal', 'ARS'], ['aston villa', 'AVL'], ['bournemouth', 'BOU'], ['brentford', 'BRE'], ['brighton', 'BHA'], ['chelsea', 'CHE'],
  ['crystal palace', 'CRY'], ['everton', 'EVE'], ['fulham', 'FUL'], ['liverpool', 'LIV'], ['man city', 'MCI'], ['man united', 'MUN'],
  ['newcastle', 'NEW'], ['nottingham forest', 'NFO'], ['tottenham', 'TOT'], ['west ham', 'WHU'], ['wolves', 'WOL'], ['leeds', 'LEE'],
  ['burnley', 'BUR'], ['sunderland', 'SUN'], ['real madrid', 'RMA'], ['barcelona', 'BAR'], ['atl madrid', 'ATM'], ['sevilla', 'SEV'],
  ['real sociedad', 'RSO'], ['villarreal', 'VIL'], ['athletic', 'ATH'], ['real betis', 'BET'], ['valencia', 'VAL'], ['girona', 'GIR'],
  ['juventus', 'JUV'], ['milan', 'MIL'], ['inter', 'INT'], ['napoli', 'NAP'], ['roma', 'ROM'], ['lazio', 'LAZ'], ['atalanta', 'ATA'],
  ['fiorentina', 'FIO'], ['bayern', 'BAY'], ['dortmund', 'BVB'], ['leverkusen', 'B04'], ['leipzig', 'RBL'], ['psg', 'PSG'],
  ['marseille', 'OM'], ['lyon', 'OL'], ['monaco', 'MON'], ['lille', 'LIL'], ['benfica', 'BEN'], ['porto', 'POR'], ['ajax', 'AJX'],
  ['celtic', 'CEL'], ['rangers', 'RAN'], ['al hilal', 'HIL'], ['al nassr', 'NAS'], ['al ittihad', 'ITT'], ['al ahli', 'AHL'],
  ['inter miami', 'MIA'], ['la galaxy', 'LAG'],
];
function abbrFor(name) {
  const n = norm(name);
  const hit = ABBR.find(([k]) => ` ${n} `.includes(` ${k} `) || n === k);
  if (hit) return hit[1];
  const words = n.split(' ').filter(Boolean);
  if (words.length <= 1) return (words[0] || '?').slice(0, 3).toUpperCase();
  return words.map((w) => w[0]).join('').slice(0, 3).toUpperCase();
}

// Marks fixtures with which side the followed team is on, and table rows that are followed.
function annotate(bundle, favTeams) {
  const favs = (favTeams || []).filter((f) => f.league === bundle.league);
  if (!favs.length) return { ...bundle, fixtures: (bundle.fixtures || []).map((m) => ({ ...m, favSide: null })) };
  const side = (m) => {
    if (favs.some((f) => teamMatches(f, m.home, m.src))) return 'home';
    if (favs.some((f) => teamMatches(f, m.away, m.src))) return 'away';
    return null;
  };
  return {
    ...bundle,
    fixtures: (bundle.fixtures || []).map((m) => ({ ...m, favSide: side(m) })),
    table: (bundle.table || []).map((g) => ({ ...g, rows: g.rows.map((r) => ({ ...r, fav: favs.some((f) => teamMatches(f, r, r.src)) })) })),
  };
}

module.exports = { norm, sameName, teamMatches, abbrFor, annotate };
