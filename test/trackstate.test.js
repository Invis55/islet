const assert = require('assert');
const { TrackState } = require('../trackstate');

const flag = (f, scope = 'Track', sector = null, message = '') => ({ category: 'Flag', flag: f, scope, sector, message });
const sc = (message) => ({ category: 'SafetyCar', flag: null, message });
const sess = (message) => ({ category: 'SessionStatus', flag: null, message });
const t = new TrackState();
const step = (ev) => t.apply(ev);

assert.strictEqual(t.mode, 'green');
assert.strictEqual(step(sess('SESSION STARTED')).mode, 'green');

// local yellows come and go by marshal sector
let r = step(flag('YELLOW', 'Sector', 7, 'YELLOW IN TRACK SECTOR 7'));
assert.deepStrictEqual([r.mode, r.sign, r.label, r.changed], ['yellow', 'Y', 'YELLOW · S7', true]);
r = step(flag('YELLOW', 'Sector', 8)); assert.strictEqual(r.label, 'YELLOW · S7, S8');
r = step(flag('CLEAR', 'Sector', 7)); assert.deepStrictEqual([r.mode, r.sectors, r.pulseGreen], ['yellow', [8], false], 'still yellow in sector 8');
r = step(flag('DOUBLE YELLOW', 'Sector', 8)); assert.deepStrictEqual([r.mode, r.sign], ['double', 'YY']);
r = step(flag('CLEAR', 'Sector', 8)); assert.deepStrictEqual([r.mode, r.pulseGreen], ['green', true], 'last yellow cleared -> flash green');
step(flag('YELLOW', 'Driver', null, 'YELLOW FOR CAR 44')); assert.strictEqual(t.mode, 'green', 'a yellow for one car is not a track yellow');

// safety car outranks yellows; "in this lap" keeps it amber; green flag ends everything
step(flag('YELLOW', 'Sector', 3));
r = step(sc('SAFETY CAR DEPLOYED')); assert.deepStrictEqual([r.mode, r.sign, r.label], ['sc', 'SC', 'SAFETY CAR']);
step(flag('DOUBLE YELLOW', 'Sector', 4)); assert.strictEqual(t.mode, 'sc');
r = step(sc('SAFETY CAR IN THIS LAP')); assert.deepStrictEqual([r.mode, r.sign], ['sc-end', 'SC']);
r = step(flag('GREEN', 'Track')); assert.deepStrictEqual([r.mode, r.pulseGreen, r.sectors], ['green', true, []], 'green flag clears SC and leftover yellows');

// virtual safety car
r = step(sc('VIRTUAL SAFETY CAR DEPLOYED')); assert.deepStrictEqual([r.mode, r.sign], ['vsc', 'VSC']);
r = step(sc('VIRTUAL SAFETY CAR ENDING')); assert.strictEqual(r.mode, 'vsc-end');
r = step(flag('CLEAR', 'Track')); assert.strictEqual(r.mode, 'vsc-end', 'a track-clear alone does not end a VSC, the green flag does');
r = step(flag('GREEN', 'Track')); assert.deepStrictEqual([r.mode, r.pulseGreen], ['green', true]);

// red flag beats everything, and a restart clears it
step(sc('SAFETY CAR DEPLOYED'));
r = step(flag('RED', 'Track', null, 'RED FLAG')); assert.deepStrictEqual([r.mode, r.sign, r.label], ['red', 'RED', 'RED FLAG']);
step(flag('YELLOW', 'Sector', 1)); assert.strictEqual(t.mode, 'red');
r = step(flag('GREEN', 'Track')); assert.deepStrictEqual([r.mode, r.pulseGreen], ['green', true]);

// chequered flag
r = step(flag('CHEQUERED', 'Track')); assert.deepStrictEqual([r.mode, r.pulseGreen], ['chequered', false]);
r = step(sess('SESSION FINISHED')); assert.strictEqual(r.mode, 'chequered', 'chequered stays until a new session starts');
step(sess('SESSION STARTED')); assert.strictEqual(t.mode, 'green');

// robustness: junk and unknown events never throw or change anything
for (const ev of [{}, { category: 'Other', message: 'CAR 1 TIME 1:20.1 DELETED' }, { category: 'Flag', flag: 'BLUE', scope: 'Driver' }, { category: 'Flag', flag: 'BLACK AND WHITE', scope: 'Driver' }, { category: null }]) {
  const before = t.mode; assert.doesNotThrow(() => step(ev)); assert.strictEqual(t.mode, before);
}
// a track-wide yellow (scope Track) is honoured
t.reset(); assert.strictEqual(step(flag('YELLOW', 'Track')).mode, 'yellow'); assert.strictEqual(step(flag('CLEAR', 'Track')).mode, 'green');
console.log('track state tests passed');
