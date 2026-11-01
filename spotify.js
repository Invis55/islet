'use strict';
// Spotify Web API, signed in with the Authorization Code + PKCE flow (no client secret).
// The user supplies their own Client ID (Spotify developer dashboard). Redirect URI: http://127.0.0.1:47615/spotify/callback
// (Spotify only allows http for loopback IP literals, and not "localhost".)
const crypto = require('crypto');

const AUTH = 'https://accounts.spotify.com';
const API = 'https://api.spotify.com/v1';
const SCOPES = ['user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing',
  'user-library-read', 'user-library-modify', 'playlist-read-private', 'playlist-read-collaborative'];

class SpotifyError extends Error {
  constructor(kind, message, status) { super(message); this.kind = kind; this.status = status; }
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function makePkce() {
  const verifier = b64url(crypto.randomBytes(48));
  return { verifier, challenge: b64url(crypto.createHash('sha256').update(verifier).digest()) };
}

const ID_RE = /^[A-Za-z0-9]{22}$/;
const URI_RE = /^spotify:(playlist|album|artist):[A-Za-z0-9]{10,32}$/;

function normalizePlayer(j) {
  if (!j || !j.device) return { active: false };
  const it = j.item || null;
  const imgs = it ? ((it.album && it.album.images) || (it.images) || (it.show && it.show.images) || []) : [];
  const art = (imgs.find((i) => i.width && i.width <= 320) || imgs[imgs.length - 1] || imgs[0] || {}).url || '';
  return {
    active: true, playing: !!j.is_playing, progress: j.progress_ms || 0, shuffle: !!j.shuffle_state, repeat: j.repeat_state || 'off',
    device: { id: j.device.id, name: j.device.name, type: j.device.type, volume: j.device.volume_percent, supportsVolume: j.device.volume_percent != null },
    track: it ? {
      id: it.id, uri: it.uri, kind: it.type || 'track', name: it.name, duration: it.duration_ms || 0,
      artists: (it.artists || (it.show ? [{ name: it.show.name }] : [])).map((a) => a.name).join(', '),
      album: (it.album && it.album.name) || '', art,
    } : null,
  };
}

function createSpotify({ fetchFn = globalThis.fetch, getClientId = () => '', redirectUri, loadTokens = () => null, saveTokens = () => {}, clock = Date.now }) {
  let tokens = loadTokens() || null;           // { access, refresh, expires }
  let pending = null;                          // { state, verifier, at }
  const likedCache = new Map();                // track id -> boolean

  const connected = () => !!(tokens && tokens.refresh);

  function begin() {
    const id = String(getClientId() || '').trim();
    if (!id) throw new SpotifyError('noclient', 'Add your Spotify Client ID first');
    const { verifier, challenge } = makePkce();
    const state = b64url(crypto.randomBytes(16));
    pending = { state, verifier, at: clock() };
    const q = new URLSearchParams({ client_id: id, response_type: 'code', redirect_uri: redirectUri, code_challenge_method: 'S256', code_challenge: challenge, state, scope: SCOPES.join(' ') });
    return `${AUTH}/authorize?${q}`;
  }

  async function tokenRequest(params) {
    const res = await fetchFn(`${AUTH}/api/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() });
    let j = {};
    try { j = await res.json(); } catch { /* empty body */ }
    if (!res.ok) throw new SpotifyError('auth', j.error_description || j.error || `Spotify answered ${res.status}`, res.status);
    return j;
  }
  function setTokens(j, prev) {
    tokens = { access: j.access_token, refresh: j.refresh_token || (prev && prev.refresh), expires: clock() + (j.expires_in || 3600) * 1000 };
    saveTokens(tokens);
  }

  async function handleCallback(query) {
    const get = (k) => (typeof query.get === 'function' ? query.get(k) : query[k]);
    if (get('error')) throw new SpotifyError('denied', get('error') === 'access_denied' ? 'You declined access on Spotify' : String(get('error')));
    if (!pending || !get('state') || get('state') !== pending.state || clock() - pending.at > 10 * 60000) {
      pending = null;
      throw new SpotifyError('state', 'That sign-in link expired or didn’t come from Islet. Start again from Islet.');
    }
    const j = await tokenRequest({ grant_type: 'authorization_code', code: get('code') || '', redirect_uri: redirectUri, client_id: String(getClientId()).trim(), code_verifier: pending.verifier });
    pending = null;
    setTokens(j);
    likedCache.clear();
  }

  function disconnect() { tokens = null; pending = null; likedCache.clear(); saveTokens(null); }

  async function accessToken() {
    if (!tokens) throw new SpotifyError('noauth', 'Spotify isn’t connected');
    if (clock() > tokens.expires - 60000) {
      try { setTokens(await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh, client_id: String(getClientId()).trim() }), tokens); }
      catch (e) { if (e.status === 400 || e.status === 401) disconnect(); throw e; } // revoked or Client ID changed: sign in again
    }
    return tokens.access;
  }

  async function api(method, path, { query, body } = {}) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await accessToken();
      const res = await fetchFn(`${API}${path}${query ? `?${new URLSearchParams(query)}` : ''}`, {
        method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 401 && attempt === 0) { tokens.expires = 0; continue; } // token rejected: refresh once and retry
      if (res.status === 204 || res.status === 202) return null;
      if (res.status === 429) throw new SpotifyError('rate', 'Spotify is rate limiting. Try again in a moment', 429);
      let j = null;
      try { j = await res.json(); } catch { /* no body */ }
      if (!res.ok) {
        const err = j && j.error;
        const reason = err && err.reason;
        const msg = (err && (err.message || err)) || `Spotify answered ${res.status}`;
        throw new SpotifyError(reason === 'PREMIUM_REQUIRED' ? 'premium' : res.status === 404 ? 'nodevice' : res.status === 403 ? 'forbidden' : 'http', String(msg), res.status);
      }
      return j;
    }
    throw new SpotifyError('http', 'Spotify rejected the request');
  }

  async function state() {
    const p = normalizePlayer(await api('GET', '/me/player', { query: { additional_types: 'episode' } }));
    if (p.active && p.track && p.track.kind === 'track' && ID_RE.test(p.track.id || '')) {
      const id = p.track.id;
      if (!likedCache.has(id)) {
        try { const r = await api('GET', '/me/tracks/contains', { query: { ids: id } }); likedCache.set(id, !!(r && r[0])); } catch { likedCache.set(id, false); }
      }
      p.track.liked = likedCache.get(id);
    }
    return p;
  }

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(n) || 0)));
  async function command(cmd, arg) {
    switch (cmd) {
      case 'play': return api('PUT', '/me/player/play');
      case 'pause': return api('PUT', '/me/player/pause');
      case 'next': return api('POST', '/me/player/next');
      case 'prev': return api('POST', '/me/player/previous');
      case 'seek': return api('PUT', '/me/player/seek', { query: { position_ms: clamp(arg, 0, 36000000) } });
      case 'volume': return api('PUT', '/me/player/volume', { query: { volume_percent: clamp(arg, 0, 100) } });
      case 'shuffle': return api('PUT', '/me/player/shuffle', { query: { state: arg ? 'true' : 'false' } });
      case 'repeat': return api('PUT', '/me/player/repeat', { query: { state: ['off', 'context', 'track'].includes(arg) ? arg : 'off' } });
      case 'like': {
        if (!arg || !ID_RE.test(arg.id || '')) throw new SpotifyError('bad', 'Unknown track');
        await api(arg.on ? 'PUT' : 'DELETE', '/me/tracks', { query: { ids: arg.id } });
        likedCache.set(arg.id, !!arg.on);
        return null;
      }
      case 'transfer':
        if (typeof arg !== 'string' || !arg || arg.length > 64) throw new SpotifyError('bad', 'Unknown device');
        return api('PUT', '/me/player', { body: { device_ids: [arg], play: true } });
      case 'playContext':
        if (!URI_RE.test(arg || '')) throw new SpotifyError('bad', 'Unknown playlist');
        return api('PUT', '/me/player/play', { body: { context_uri: arg } });
      default: throw new SpotifyError('bad', `Unknown command ${cmd}`);
    }
  }

  async function playlists() {
    const j = await api('GET', '/me/playlists', { query: { limit: '30' } });
    return ((j && j.items) || []).filter(Boolean).map((p) => {
      const imgs = p.images || [];
      return { id: p.id, uri: p.uri, name: p.name, image: (imgs[imgs.length - 1] || imgs[0] || {}).url || '',
        count: (p.tracks && p.tracks.total) ?? (p.items && p.items.total) ?? null };
    });
  }
  async function devices() {
    const j = await api('GET', '/me/player/devices');
    return ((j && j.devices) || []).map((d) => ({ id: d.id, name: d.name, type: d.type, active: !!d.is_active, volume: d.volume_percent }));
  }

  return { connected, begin, handleCallback, disconnect, state, command, playlists, devices, api };
}

module.exports = { createSpotify, makePkce, normalizePlayer, SpotifyError, SCOPES };
