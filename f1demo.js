'use strict';
// A scripted, offline "race" with the same interface as the OpenF1 source: 22 cars on a made-up circuit and a timeline that
// walks through every track status (yellows, safety car, VSC, red flag, chequered). Lets you try the Live tab and the ambient
// lights without waiting for a real session.
const BASE = Date.UTC(2026, 0, 1);
const LENGTH = 130; // seconds, then it loops

const DRIVERS = [
  ['VER', 'Max Verstappen', 'Red Bull', '#3671C6'], ['NOR', 'Lando Norris', 'McLaren', '#FF8000'], ['PIA', 'Oscar Piastri', 'McLaren', '#FF8000'],
  ['LEC', 'Charles Leclerc', 'Ferrari', '#E8002D'], ['HAM', 'Lewis Hamilton', 'Ferrari', '#E8002D'], ['RUS', 'George Russell', 'Mercedes', '#27F4D2'],
  ['ANT', 'Kimi Antonelli', 'Mercedes', '#27F4D2'], ['ALO', 'Fernando Alonso', 'Aston Martin', '#229971'], ['STR', 'Lance Stroll', 'Aston Martin', '#229971'],
  ['GAS', 'Pierre Gasly', 'Alpine', '#FF87BC'], ['COL', 'Franco Colapinto', 'Alpine', '#FF87BC'], ['ALB', 'Alexander Albon', 'Williams', '#64C4FF'],
  ['SAI', 'Carlos Sainz', 'Williams', '#64C4FF'], ['HAD', 'Isack Hadjar', 'Red Bull', '#3671C6'], ['LIN', 'Arvid Lindblad', 'Racing Bulls', '#6692FF'],
  ['LAW', 'Liam Lawson', 'Racing Bulls', '#6692FF'], ['BEA', 'Oliver Bearman', 'Haas', '#B6BABD'], ['OCO', 'Esteban Ocon', 'Haas', '#B6BABD'],
  ['HUL', 'Nico Hulkenberg', 'Audi', '#52E252'], ['BOR', 'Gabriel Bortoleto', 'Audi', '#52E252'],
  ['PER', 'Sergio Perez', 'Cadillac', '#AAAAAD'], ['BOT', 'Valtteri Bottas', 'Cadillac', '#AAAAAD'],
].map((d, i) => ({ n: i + 1, code: d[0], name: d[1], team: d[2], color: d[3] }));

// [seconds, category, flag, scope, sector, message]
const SCRIPT = [
  [0, 'SessionStatus', null, null, null, 'SESSION STARTED'],
  [8, 'Flag', 'YELLOW', 'Sector', 7, 'YELLOW IN TRACK SECTOR 7'],
  [13, 'Flag', 'YELLOW', 'Sector', 8, 'YELLOW IN TRACK SECTOR 8'],
  [19, 'Flag', 'CLEAR', 'Sector', 7, 'CLEAR IN TRACK SECTOR 7'],
  [22, 'Flag', 'CLEAR', 'Sector', 8, 'CLEAR IN TRACK SECTOR 8'],
  [30, 'SafetyCar', null, 'Track', null, 'SAFETY CAR DEPLOYED'],
  [50, 'SafetyCar', null, 'Track', null, 'SAFETY CAR IN THIS LAP'],
  [58, 'Flag', 'GREEN', 'Track', null, 'GREEN LIGHT - PIT EXIT OPEN'],
  [68, 'SafetyCar', null, 'Track', null, 'VIRTUAL SAFETY CAR DEPLOYED'],
  [80, 'SafetyCar', null, 'Track', null, 'VIRTUAL SAFETY CAR ENDING'],
  [86, 'Flag', 'GREEN', 'Track', null, 'GREEN LIGHT - PIT EXIT OPEN'],
  [96, 'Flag', 'RED', 'Track', null, 'RED FLAG'],
  [110, 'Flag', 'GREEN', 'Track', null, 'GREEN LIGHT - PIT EXIT OPEN'],
  [122, 'Flag', 'CHEQUERED', 'Track', null, 'CHEQUERED FLAG'],
];
// relative speed of the field over time: normal, safety car, normal, VSC, normal, red flag (parked), normal
const SPEED = [[0, 1], [30, 0.5], [58, 1], [68, 0.7], [86, 1], [96, 0], [110, 1]];
const LAPS_PER_SEC = 0.012;

function progressAt(sec) { // integral of the speed profile -> distance travelled by the field (in laps)
  let total = 0;
  for (let i = 0; i < SPEED.length; i++) {
    const [from, f] = SPEED[i], to = i + 1 < SPEED.length ? SPEED[i + 1][0] : Infinity;
    if (sec <= from) break;
    total += (Math.min(sec, to) - from) * f;
  }
  return total * LAPS_PER_SEC;
}
const curve = (u) => { const a = u * Math.PI * 2; return { x: Math.round(5200 * Math.cos(a) + 900 * Math.cos(3 * a + 1)), y: Math.round(3000 * Math.sin(a) + 700 * Math.sin(2 * a + 0.5)) }; };
const driverProgress = (i, sec) => progressAt(sec) * (1 + 0.0006 * (((i * 7) % 5) - 2)) - i * 0.012; // starts in grid order, a few overtakes

function createDemoSource() {
  const session = { key: 'demo', name: 'Demo race', type: 'Race', circuit: 'Demo circuit', country: 'Nowhere', year: 2026, start: BASE, end: BASE + LENGTH * 1000 };
  const outline = Array.from({ length: 360 }, (_, i) => curve(i / 360));
  const sec = (ms) => (ms - BASE) / 1000;
  return {
    demo: true, LENGTH, BASE,
    session: async () => session,
    drivers: async () => DRIVERS,
    outline: async () => outline,
    async location(from, to) {
      const out = [], end = to == null ? from + 6000 : to;
      for (let t = Math.ceil(from / 270) * 270; t < end; t += 270) {
        if (t < BASE || t > BASE + LENGTH * 1000) continue;
        DRIVERS.forEach((d, i) => { const p = curve(((driverProgress(i, sec(t)) % 1) + 1) % 1); out.push({ n: d.n, x: p.x, y: p.y, t }); });
      }
      return out;
    },
    async raceControl(from, to) {
      return SCRIPT.map(([s, category, flag, scope, sector, message]) => ({ t: BASE + s * 1000, category, flag, scope, sector, message, lap: 1 + Math.floor(s / 22) }))
        .filter((e) => e.t >= from && (to == null || e.t < to));
    },
    async positions(from, to) {
      const end = to == null ? from + 5000 : to, out = [];
      for (let t = Math.ceil(from / 5000) * 5000; t < end; t += 5000) {
        if (t < BASE || t > BASE + LENGTH * 1000) continue;
        DRIVERS.map((d, i) => ({ n: d.n, p: driverProgress(i, sec(t)) })).sort((a, b) => b.p - a.p).forEach((r, k) => out.push({ n: r.n, pos: k + 1, t }));
      }
      return out;
    },
    async intervals(from, to) {
      const end = to == null ? from + 5000 : to, out = [];
      for (let t = Math.ceil(from / 5000) * 5000; t < end; t += 5000) {
        if (t < BASE || t > BASE + LENGTH * 1000) continue;
        const rows = DRIVERS.map((d, i) => ({ n: d.n, p: driverProgress(i, sec(t)) })).sort((a, b) => b.p - a.p);
        rows.forEach((r, k) => out.push({ n: r.n, gap: k === 0 ? 0 : Math.round((rows[0].p - r.p) * 83 * 10) / 10, int: k === 0 ? 0 : Math.round((rows[k - 1].p - r.p) * 83 * 10) / 10, t }));
      }
      return out;
    },
  };
}

module.exports = { createDemoSource, DRIVERS, SCRIPT, BASE, LENGTH };
