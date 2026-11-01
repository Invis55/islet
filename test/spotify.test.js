const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const { createSpotify, makePkce, normalizePlayer, SpotifyError, SCOPES } = require('../spotify');
const { createServer } = require('../server');

const REDIRECT = 'http://127.0.0.1:47615/spotify/callback';
const sha = (v) => crypto.createHash('sha256').update(v).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// PKCE: challenge really is S256(verifier), base64url, in the length range Spotify requires (43-128)
const { verifier, challenge } = makePkce();
assert.strictEqual(challenge, sha(verifier)); assert.ok(verifier.length >= 43 && verifier.length <= 128); assert.ok(/^[A-Za-z0-9_-]+$/.test(verifier));

const TRACK = '4uLU6hMCjMI75M1A2tKUQC', PL = '37i9dQZF1DXcBWIGoYBM5M';
const playerJson = { device: { id: 'dev1', name: 'DESKTOP', type: 'Computer', volume_percent: 55, is_active: true }, repeat_state: 'context', shuffle_state: true, is_playing: true, progress_ms: 42000,
  item: { id: TRACK, uri: `spotify:track:${TRACK}`, type: 'track', name: 'Blinding Lights', duration_ms: 200000, artists: [{ name: 'The Weeknd' }, { name: 'X' }],
    album: { name: 'After Hours', images: [{ url: 'big.jpg', width: 640 }, { url: 'mid.jpg', width: 300 }, { url: 'small.jpg', width: 64 }] } } };

(async () => {
  let clock = 1_000_000, saved, tokenCalls = [], apiCalls = [], nextToken = null, apiHandler = null, clientId = 'CLIENT123';
  const fetchFn = async (url, opts = {}) => {
    if (url.startsWith('https://accounts.spotify.com/api/token')) {
      const body = Object.fromEntries(new URLSearchParams(opts.body)); tokenCalls.push(body);
      if (nextToken) { const t = nextToken; nextToken = null; return t; }
      return { ok: true, status: 200, json: async () => ({ access_token: `AT${tokenCalls.length}`, refresh_token: body.grant_type === 'authorization_code' ? 'RT1' : undefined, expires_in: 3600 }) };
    }
    apiCalls.push({ method: opts.method, url, auth: opts.headers && opts.headers.Authorization, body: opts.body });
    return apiHandler(url, opts);
  };
  const sp = createSpotify({ fetchFn, getClientId: () => clientId, redirectUri: REDIRECT, saveTokens: (t) => { saved = t; }, clock: () => clock });
  const ok = (j, status = 200) => ({ ok: true, status, json: async () => j });

  // --- sign-in
  assert.strictEqual(sp.connected(), false);
  clientId = ''; assert.throws(() => sp.begin(), /Client ID/); clientId = 'CLIENT123';
  const url = new URL(sp.begin()); const q = url.searchParams;
  assert.strictEqual(url.origin + url.pathname, 'https://accounts.spotify.com/authorize');
  assert.deepStrictEqual([q.get('client_id'), q.get('response_type'), q.get('redirect_uri'), q.get('code_challenge_method')], ['CLIENT123', 'code', REDIRECT, 'S256']);
  assert.ok(q.get('code_challenge').length >= 43 && q.get('state'));
  for (const s of ['user-read-playback-state', 'user-modify-playback-state', 'user-library-modify', 'playlist-read-private']) assert.ok(q.get('scope').split(' ').includes(s), s);

  await assert.rejects(() => sp.handleCallback(new URLSearchParams({ code: 'abc', state: 'WRONG' })), /expired or didn/);
  const url2 = new URL(sp.begin()); const state2 = url2.searchParams.get('state'); const challenge2 = url2.searchParams.get('code_challenge');
  await assert.rejects(() => sp.handleCallback(new URLSearchParams({ error: 'access_denied', state: state2 })), /declined/);
  const url3 = new URL(sp.begin());
  await sp.handleCallback(new URLSearchParams({ code: 'THECODE', state: url3.searchParams.get('state') }));
  const exch = tokenCalls[0];
  assert.deepStrictEqual([exch.grant_type, exch.code, exch.redirect_uri, exch.client_id], ['authorization_code', 'THECODE', REDIRECT, 'CLIENT123']);
  assert.strictEqual(sha(exch.code_verifier), url3.searchParams.get('code_challenge'), 'verifier matches the challenge sent earlier');
  assert.ok(sp.connected()); assert.strictEqual(saved.refresh, 'RT1'); assert.strictEqual(saved.expires, clock + 3600000);
  await assert.rejects(() => sp.handleCallback(new URLSearchParams({ code: 'x', state: url3.searchParams.get('state') })), /expired or didn/, 'a state can only be used once');

  // --- player state (+ liked flag, cached per track)
  apiHandler = async (u) => (u.includes('/me/tracks/contains') ? ok([true]) : ok(playerJson));
  let st = await sp.state();
  assert.strictEqual(apiCalls[0].auth, 'Bearer AT1');
  assert.deepStrictEqual([st.active, st.playing, st.shuffle, st.repeat, st.device.name, st.device.volume, st.track.name, st.track.artists, st.track.art, st.track.liked],
    [true, true, true, 'context', 'DESKTOP', 55, 'Blinding Lights', 'The Weeknd, X', 'mid.jpg', true]);
  const n = apiCalls.length; await sp.state(); assert.strictEqual(apiCalls.length, n + 1, 'liked status is cached, only /me/player is called again');
  apiHandler = async () => ({ ok: true, status: 204, json: async () => { throw new Error('no body'); } });
  assert.deepStrictEqual(await sp.state(), { active: false }, '204 = nothing playing / no device');

  // --- token refresh when about to expire, and once on a 401
  clock += 3600000 - 30000; apiHandler = async () => ok(playerJson); tokenCalls.length = 0;
  await sp.state();
  assert.deepStrictEqual([tokenCalls[0].grant_type, tokenCalls[0].refresh_token, tokenCalls[0].client_id], ['refresh_token', 'RT1', 'CLIENT123']);
  assert.strictEqual(saved.refresh, 'RT1', 'refresh token is kept when Spotify omits it');
  let first = true; apiHandler = async () => { if (first) { first = false; return { ok: false, status: 401, json: async () => ({ error: { message: 'expired' } }) }; } return ok(playerJson); };
  tokenCalls.length = 0; apiCalls.length = 0; await sp.state();
  assert.strictEqual(tokenCalls.length, 1, 'one refresh after the 401'); assert.ok(apiCalls.length >= 2);

  // --- commands: right verb, path and params; arguments validated
  apiHandler = async () => ({ ok: true, status: 204, json: async () => null }); apiCalls.length = 0;
  await sp.command('pause'); await sp.command('play'); await sp.command('next'); await sp.command('prev');
  await sp.command('seek', 61234.7); await sp.command('volume', 140); await sp.command('shuffle', true); await sp.command('repeat', 'track'); await sp.command('repeat', 'bogus');
  await sp.command('like', { id: TRACK, on: true }); await sp.command('like', { id: TRACK, on: false });
  await sp.command('transfer', 'dev9'); await sp.command('playContext', `spotify:playlist:${PL}`);
  const summary = apiCalls.map((c) => { const u = new URL(c.url); return `${c.method} ${u.pathname.replace('/v1', '')}${u.search}`; });
  assert.deepStrictEqual(summary, [
    'PUT /me/player/pause', 'PUT /me/player/play', 'POST /me/player/next', 'POST /me/player/previous', 'PUT /me/player/seek?position_ms=61235',
    'PUT /me/player/volume?volume_percent=100', 'PUT /me/player/shuffle?state=true', 'PUT /me/player/repeat?state=track', 'PUT /me/player/repeat?state=off',
    `PUT /me/tracks?ids=${TRACK}`, `DELETE /me/tracks?ids=${TRACK}`, 'PUT /me/player', 'PUT /me/player/play']);
  assert.deepStrictEqual(JSON.parse(apiCalls[11].body), { device_ids: ['dev9'], play: true });
  assert.deepStrictEqual(JSON.parse(apiCalls[12].body), { context_uri: `spotify:playlist:${PL}` });
  await assert.rejects(() => sp.command('like', { id: '../../etc', on: true }), /Unknown track/);
  await assert.rejects(() => sp.command('playContext', 'spotify:user:x:playlist:y'), /Unknown playlist/);
  await assert.rejects(() => sp.command('launch'), /Unknown command/);

  // --- playlists + devices
  apiHandler = async (u) => ok(u.includes('/devices') ? { devices: [{ id: 'd1', name: 'Phone', type: 'Smartphone', is_active: false, volume_percent: 30 }] }
    : { items: [{ id: PL, uri: `spotify:playlist:${PL}`, name: 'Today’s Top Hits', images: [{ url: 'a.jpg' }, { url: 'b.jpg' }], tracks: { total: 50 } }, null, { id: 'x', uri: 'spotify:playlist:xxxxxxxxxx', name: 'No cover', images: [], items: { total: 3 } }] });
  const pls = await sp.playlists();
  assert.deepStrictEqual(pls.map((p) => [p.name, p.image, p.count]), [['Today’s Top Hits', 'b.jpg', 50], ['No cover', '', 3]]);
  assert.deepStrictEqual((await sp.devices())[0], { id: 'd1', name: 'Phone', type: 'Smartphone', active: false, volume: 30 });

  // --- error mapping
  const fail = (status, error) => async () => ({ ok: false, status, json: async () => ({ error }) });
  apiHandler = fail(403, { status: 403, message: 'Player command failed: Premium required', reason: 'PREMIUM_REQUIRED' });
  await assert.rejects(() => sp.command('next'), (e) => e instanceof SpotifyError && e.kind === 'premium');
  apiHandler = fail(404, { status: 404, message: 'Player command failed: No active device found', reason: 'NO_ACTIVE_DEVICE' });
  await assert.rejects(() => sp.command('next'), (e) => e.kind === 'nodevice');
  apiHandler = async () => ({ ok: false, status: 429, json: async () => ({}) });
  await assert.rejects(() => sp.command('next'), (e) => e.kind === 'rate');

  // --- a revoked refresh token signs the user out instead of looping
  clock += 7200000; nextToken = { ok: false, status: 400, json: async () => ({ error: 'invalid_grant', error_description: 'Refresh token revoked' }) };
  await assert.rejects(() => sp.state(), /revoked/); assert.strictEqual(sp.connected(), false); assert.strictEqual(saved, null);
  await assert.rejects(() => sp.state(), /isn’t connected/);

  // podcasts: no liked lookup, show name used for artists
  const ep = normalizePlayer({ device: { id: 'd', name: 'n', type: 't' }, is_playing: true, item: { id: 'e1', type: 'episode', name: 'Ep 1', duration_ms: 1, show: { name: 'The Show', images: [{ url: 's.jpg' }] } } });
  assert.deepStrictEqual([ep.track.kind, ep.track.artists, ep.track.art, ep.device.supportsVolume], ['episode', 'The Show', 's.jpg', false]);

  // --- the loopback callback route on the local server
  const got = []; let result = { ok: true, message: 'You can close this tab and go back to Islet.' };
  const bridge = createServer({ port: 47997, onNotify() {}, onClaudeActivity() {}, onClaudeDone() {}, onPermission() {}, onSpotifyCallback: async (q) => { got.push(q.get('code') + '/' + q.get('state')); return result; } });
  await bridge.listen();
  const hit = (p) => new Promise((resolve) => http.get({ host: '127.0.0.1', port: 47997, path: p }, (r) => { let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => resolve({ status: r.statusCode, body: d })); }));
  let r = await hit('/spotify/callback?code=C1&state=S1');
  assert.strictEqual(r.status, 200); assert.ok(r.body.includes('Spotify connected')); assert.deepStrictEqual(got, ['C1/S1']);
  result = { ok: false, message: '<script>alert(1)</script>' };
  r = await hit('/spotify/callback?error=access_denied'); assert.strictEqual(r.status, 400); assert.ok(!r.body.includes('<script>alert'), 'message is HTML-escaped');
  bridge.close();

  console.log('spotify tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
