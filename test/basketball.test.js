// NBA data: scoreboard and conference standings, parsed from ESPN's public JSON (shapes checked against the live API).
const assert = require('assert');
const { parseScoreboard, parseStandings, createBasketball, nbaTeamOf } = require('../sports');

const game = (over = {}) => ({
  id: '401909896', date: '2026-10-31T19:00Z', name: 'Portland Trail Blazers at Utah Jazz',
  status: { type: { name: 'STATUS_FINAL', state: 'post', detail: 'Final', shortDetail: 'Final' } },
  competitions: [{ competitors: [
    { homeAway: 'home', score: '90', team: { id: '26', displayName: 'Utah Jazz', shortDisplayName: 'Jazz', abbreviation: 'UTA', logo: 'https://a.espncdn.com/i/teamlogos/nba/500/utah.png' } },
    { homeAway: 'away', score: '101', team: { id: '22', displayName: 'Portland Trail Blazers', shortDisplayName: 'Trail Blazers', abbreviation: 'POR' } },
  ] }],
  ...over,
});

const standings = {
  name: 'National Basketball Association',
  children: [
    { name: 'Eastern Conference', standings: { entries: [
      { team: { id: '17', displayName: 'Brooklyn Nets', shortDisplayName: 'Nets', abbreviation: 'BKN', logos: [{ href: 'https://a.espncdn.com/i/teamlogos/nba/500/bkn.png' }] },
        stats: [{ name: 'wins', value: 4 }, { name: 'losses', value: 5 }, { name: 'pointsFor', value: 551 }, { name: 'pointsAgainst', value: 606 }, { name: 'pointDifferential', value: -55 }] },
      { team: { id: '1', displayName: 'Atlanta Hawks', shortDisplayName: 'Hawks', abbreviation: 'ATL' },
        stats: [{ name: 'wins', value: 7 }, { name: 'losses', value: 2 }] },
    ] } },
    { name: 'Western Conference', standings: { entries: [
      { team: { id: '26', displayName: 'Utah Jazz', shortDisplayName: 'Jazz', abbreviation: 'UTA' }, stats: [{ name: 'wins', value: 1 }, { name: 'losses', value: 5 }] },
    ] } },
  ],
};

// scoreboard: parses, marks state, scores, and drops duplicates and broken rows
{
  const g = parseScoreboard({ events: [game(), game(), { id: 'x', competitions: [{ competitors: [] }] }] });
  assert.strictEqual(g.length, 1, 'duplicate ids and empty games dropped');
  assert.strictEqual(g[0].state, 'post'); assert.strictEqual(g[0].label, 'FT');
  assert.strictEqual(g[0].home.name, 'Jazz'); assert.strictEqual(g[0].home.score, 90); assert.strictEqual(g[0].away.score, 101);
  assert.strictEqual(g[0].home.abbr, 'UTA');
  const live = parseScoreboard({ events: [game({ status: { type: { name: 'STATUS_IN_PROGRESS', state: 'in', detail: '3rd Quarter', shortDetail: '3rd 4:12' } } })] })[0];
  assert.strictEqual(live.state, 'in'); assert.strictEqual(live.label, '3rd 4:12', 'live games show the quarter and clock');
}

// standings: one group per conference, rows keep ESPN's order, W-L present
{
  const groups = parseStandings(standings);
  assert.strictEqual(groups.length, 2, 'one group per conference');
  assert.deepStrictEqual(groups.map((g) => g.name), ['Eastern Conference', 'Western Conference']);
  assert.strictEqual(groups[0].rows.length, 2);
  assert.deepStrictEqual([groups[0].rows[0].w, groups[0].rows[0].l, groups[0].rows[0].gd], [4, 5, -55]);
  assert.strictEqual(groups[0].rows[0].rank, 1, 'rank falls back to list position');
  assert.strictEqual(groups[1].rows[0].name, 'Jazz');
}

// team shape the app stores is stable and tolerant of missing fields
{
  assert.deepStrictEqual(nbaTeamOf({ id: 26, name: 'Jazz' }), { id: '26', name: 'Jazz', full: 'Jazz', abbr: '', logo: '' });
  assert.strictEqual(nbaTeamOf({}).name, '?');
}

// bundle: caches per TTL, survives one endpoint failing, reports the error without throwing
(async () => {
  let t = 0; const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    if (/scoreboard/.test(url)) return { ok: true, status: 200, json: async () => ({ events: [game()] }), text: async () => '' };
    return { ok: false, status: 500, json: async () => ({}), text: async () => '' };
  };
  const bb = createBasketball({ fetchFn, clock: () => t });
  const b1 = await bb.bundle();
  assert.strictEqual(b1.games.length, 1, 'games still show when standings fail');
  assert.ok(b1.error, 'the failure is reported');
  assert.deepStrictEqual(b1.groups, []);
  await bb.bundle();
  assert.strictEqual(calls.filter((u) => /scoreboard/.test(u)).length, 1, 'games are cached for 45 s');
  t += 46000;
  await bb.bundle();
  assert.strictEqual(calls.filter((u) => /scoreboard/.test(u)).length, 2, 'refetched after the TTL');
  console.log('basketball tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
