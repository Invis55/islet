const assert = require('assert');
const { sameName, teamMatches, abbrFor, annotate } = require('../teams');

// names differ between providers; these must be recognised as the same club
for (const [a, b] of [['Manchester City', 'Man City'], ['Tottenham', 'Tottenham Hotspur'], ['Wolves', 'Wolverhampton Wanderers'],
  ['Bayern Munich', 'Bayern München'], ['AC Milan', 'Milan'], ['Newcastle', 'Newcastle United'], ['Paris Saint-Germain', 'PSG'],
  ['Brighton', 'Brighton & Hove Albion'], ['Atlético Madrid', 'Atletico Madrid'], ['Arsenal', 'Arsenal FC']]) {
  assert.ok(sameName(a, b), `${a} should equal ${b}`);
}
for (const [a, b] of [['Arsenal', 'Chelsea'], ['Manchester United', 'Manchester City'], ['Real Madrid', 'Real Betis'], ['', 'Arsenal'], ['Ars', 'Arsenal']]) {
  assert.ok(!sameName(a, b), `${a} should NOT equal ${b}`);
}

// ids only count within the same provider
const fav = { league: 'eng.1', id: '359', src: 'espn', name: 'Arsenal', full: 'Arsenal FC' };
assert.ok(teamMatches(fav, { id: '359', name: 'whatever' }, 'espn'));
assert.ok(!teamMatches(fav, { id: '359', name: 'Other Team' }, 'af'), 'same id from another provider means nothing');
assert.ok(teamMatches(fav, { id: '42', name: 'Arsenal', full: 'Arsenal' }, 'af'), 'but the name still matches');

assert.strictEqual(abbrFor('Arsenal'), 'ARS');
assert.strictEqual(abbrFor('Manchester City'), 'MCI');
assert.strictEqual(abbrFor('Manchester United'), 'MUN');
assert.strictEqual(abbrFor('Paris Saint Germain'), 'PSG');
assert.strictEqual(abbrFor('Borussia Mönchengladbach'), 'BM');
assert.strictEqual(abbrFor('Sheffield'), 'SHE');

const bundle = {
  league: 'eng.1',
  fixtures: [{ src: 'af', home: { id: '42', name: 'Arsenal', full: 'Arsenal' }, away: { id: '49', name: 'Chelsea', full: 'Chelsea' } },
    { src: 'af', home: { id: '40', name: 'Liverpool', full: 'Liverpool' }, away: { id: '50', name: 'Manchester City', full: 'Manchester City' } }],
  table: [{ name: '', rows: [{ src: 'af', id: '42', name: 'Arsenal', full: 'Arsenal' }, { src: 'af', id: '40', name: 'Liverpool', full: 'Liverpool' }] }],
};
const a = annotate(bundle, [fav, { league: 'esp.1', id: '1', name: 'Barcelona' }, { league: 'eng.1', id: 'x', src: 'espn', name: 'Man City', full: 'Manchester City' }]);
assert.deepStrictEqual(a.fixtures.map((f) => f.favSide), ['home', 'away']);
assert.deepStrictEqual(a.table[0].rows.map((r) => r.fav), [true, false]);
assert.deepStrictEqual(annotate(bundle, []).fixtures.map((f) => f.favSide), [null, null]);
console.log('teams tests passed');
