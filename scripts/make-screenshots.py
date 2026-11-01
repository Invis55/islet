#!/usr/bin/env python3
"""Render the real Islet UI (renderer/*.html) with sample data and save screenshots to docs/screenshots.

The screenshots are of the shipped interface, not mockups: the bridge to the Electron main process
is replaced by a small stand-in that returns sample data. Run after UI changes:

    pip install playwright && python -m playwright install chromium
    python scripts/make-screenshots.py
"""
import json, pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'docs' / 'screenshots'
OUT.mkdir(parents=True, exist_ok=True)

from datetime import datetime, timedelta, timezone
# 9:00 AM in Karachi on 1 Nov 2026: a fixed clock, so the screenshots are identical on every run
FIXED = datetime(2026, 11, 1, 9, 0, tzinfo=timezone(timedelta(hours=5)))
NOW = int(FIXED.timestamp() * 1000)
CAL = {"configured": True, "error": "", "updated": NOW, "events": [
    {"title": "Standup", "start": NOW + 1 * 3600000, "end": NOW + 1.5 * 3600000, "join": "https://meet.google.com/abc-defg-hij"},
    {"title": "Design review", "start": NOW + 3 * 3600000, "end": NOW + 4 * 3600000, "location": "Room 4B"},
    {"title": "Planning", "start": NOW + 26 * 3600000, "end": NOW + 27 * 3600000},
]}
SAMPLE_GAMES = [
    {"id": "1", "src": "espn", "date": NOW - 7200000, "state": "post", "label": "FT", "home": {"id": "26", "name": "Jazz", "full": "Utah Jazz", "abbr": "UTA", "logo": "", "score": 90}, "away": {"id": "22", "name": "Trail Blazers", "full": "Portland Trail Blazers", "abbr": "POR", "logo": "", "score": 101}},
    {"id": "2", "src": "espn", "date": NOW - 3600000, "state": "in", "label": "3rd 4:12", "home": {"id": "17", "name": "Nets", "full": "Brooklyn Nets", "abbr": "BKN", "logo": "", "score": 62}, "away": {"id": "1", "name": "Hawks", "full": "Atlanta Hawks", "abbr": "ATL", "logo": "", "score": 70}},
]
SAMPLE_GROUPS = [{"name": "Eastern Conference", "rows": [
    {"rank": 1, "id": "1", "name": "Hawks", "full": "Atlanta Hawks", "abbr": "ATL", "logo": "", "w": 7, "l": 2, "gd": 45, "pts": 0},
    {"rank": 2, "id": "17", "name": "Nets", "full": "Brooklyn Nets", "abbr": "BKN", "logo": "", "w": 4, "l": 5, "gd": -55, "pts": 0}]}]

BRIDGE = """
(() => {
  const cbs = {}; const on = (k) => (cb) => { (cbs[k] = cbs[k] || []).push(cb); };
  window.__emit = (k, d) => (cbs[k] || []).forEach((cb) => cb(d));
  const settings = { notch: true, musicPill: true, sound: true, clipboard: true, popupFromNotifs: false, favTeams: [], favDrivers: [],
    favConstructor: '', nbaTeams: [], f1Ambient: true, f1CalmLights: false, f1LiveWatch: true, openf1User: '', onboarded: %(onboarded)s,
    footballLeague: 'eng.1', modules: { sports: %(sports)s, focus: true, tasks: true }, quietFocus: true, autostart: false };
  const push = () => (cbs.settings || []).forEach((cb) => cb(JSON.parse(JSON.stringify(settings))));
  const api = {
    // the app sends settings after the page has loaded, so do the same here (all scripts are registered by then)
    onSettings: (cb) => { on('settings')(cb); window.addEventListener('load', push); },
    updateSettings: (patch) => { if (patch.modules) Object.assign(settings.modules, patch.modules);
      for (const [k, v] of Object.entries(patch)) if (typeof v === 'boolean') settings[k] = v; push(); },
    nbaGet: async () => ({ games: %(games)s, groups: %(groups)s, error: '', favs: [], updated: %(now)s }),
    tasksLoad: async () => %(tasks)s, tasksSave: async () => ({ ok: true }),
    getFootball: async () => ({ fixtures: [], table: [], error: '' }), getF1: async () => ({ races: [], drivers: { rows: [] }, teams: { rows: [] }, last: null, error: '' }),
    spotifyStatus: async () => ({ hasClient: false, connected: false, redirectUri: 'http://127.0.0.1:47615/spotify/callback' }),
    claudeStatus: async () => ({ connected: false }), f1Live: async () => ({ ok: true }), openLink() {}, closeWindow() {}, onboardingDone() {},
    onAlert: on('alert'), onCalendar: on('calendar'), onNotifs: on('notifs'), onClips: on('clips'), onMedia: on('media'),
  };
  window.islet = new Proxy(api, { get(t, k) { if (k in t) return t[k]; if (typeof k === 'string' && k.startsWith('on')) return on(k); return async () => ({}); } });
})();
"""

def page_for(b, onboarded, sports, tasks, size):
    ctx = b.new_context(viewport=size, device_scale_factor=2, bypass_csp=True, timezone_id='Asia/Karachi')
    pg = ctx.new_page()
    pg.clock.set_fixed_time(FIXED)
    init = BRIDGE % {'onboarded': 'true' if onboarded else 'false', 'sports': 'true' if sports else 'false',
                     'games': json.dumps(SAMPLE_GAMES), 'groups': json.dumps(SAMPLE_GROUPS), 'tasks': json.dumps(tasks), 'now': NOW}
    pg.add_init_script(init)
    return ctx, pg

def main():
    tasks = [{"id": "a", "text": "Send the Q4 deck to the team", "done": True},
             {"id": "b", "text": "Review the grant draft", "done": False},
             {"id": "c", "text": "Book dentist", "done": False}]
    with sync_playwright() as p:
        b = p.chromium.launch()
        # --- the panel (sports off, as shipped) ---
        ctx, pg = page_for(b, True, False, tasks, {'width': 700, 'height': 380})
        pg.goto((ROOT / 'renderer' / 'index.html').as_uri()); pg.wait_for_timeout(400)
        pg.evaluate("window.__emit('calendar', %s)" % json.dumps(CAL)); pg.wait_for_timeout(200)
        pg.mouse.move(350, 14); pg.wait_for_timeout(1100)
        pg.screenshot(path=str(OUT / 'panel-now.png'))
        for tab, name in [('calendar', 'panel-calendar'), ('tasks', 'panel-tasks'), ('focus', 'panel-focus'), ('notes', 'panel-notes')]:
            pg.click(f'[data-tab="{tab}"]'); pg.wait_for_timeout(450)
            pg.screenshot(path=str(OUT / f'{name}.png'))
        pg.click('[data-tab="focus"]'); pg.wait_for_timeout(300)
        pg.click('#fo-presets button[data-w="25"]'); pg.click('#fo-go'); pg.wait_for_timeout(1500)
        pg.mouse.move(350, 340); pg.wait_for_timeout(1300)
        # the island is a transparent window: show it over a desktop-like colour and crop to the island
        pg.evaluate("document.documentElement.style.background = '#2c2f38'; document.body.style.background = '#2c2f38'")
        pg.screenshot(path=str(OUT / 'island-focus.png'), clip={'x': 150, 'y': 0, 'width': 400, 'height': 70})
        pg.mouse.move(350, 14); pg.wait_for_timeout(1000)
        pg.click('[data-tab="settings"]'); pg.wait_for_timeout(450)
        pg.screenshot(path=str(OUT / 'panel-settings.png'))
        ctx.close()

        # --- optional: sports, when switched on ---
        ctx, pg = page_for(b, True, True, tasks, {'width': 700, 'height': 380})
        pg.goto((ROOT / 'renderer' / 'index.html').as_uri()); pg.wait_for_timeout(400)
        pg.mouse.move(350, 14); pg.wait_for_timeout(1000)
        pg.click('[data-tab="basketball"]'); pg.wait_for_timeout(700)
        pg.screenshot(path=str(OUT / 'panel-nba-optional.png'))
        ctx.close()

        # --- first-run setup, as a new user sees it ---
        ctx = b.new_context(viewport={'width': 760, 'height': 660}, device_scale_factor=2, bypass_csp=True, timezone_id='Asia/Karachi')
        pg = ctx.new_page()
        pg.clock.set_fixed_time(FIXED)
        pg.add_init_script(BRIDGE % {'onboarded': 'false', 'sports': 'false', 'games': '[]', 'groups': '[]', 'tasks': '[]', 'now': NOW})
        pg.goto((ROOT / 'renderer' / 'onboarding.html').as_uri()); pg.wait_for_timeout(500)
        pg.screenshot(path=str(OUT / 'onboarding-welcome.png'))
        pg.click('#ob-next'); pg.wait_for_timeout(500)
        pg.screenshot(path=str(OUT / 'onboarding-choose.png'))
        ctx.close()
        b.close()
    print('wrote', sorted(x.name for x in OUT.glob('*.png')))

if __name__ == '__main__':
    main()
