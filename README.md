# Islet

A Dynamic Island for Windows 11. A notch docked to the top of your screen that grows into live scores, music, alerts and a tabbed panel, styled after the iPhone Dynamic Island and Apple's Liquid Glass design.

## Install
**From a release (easiest, about 10 seconds):** download `Islet-Setup.exe` from the repo's *Releases* page (always at `/releases/latest/download/Islet-Setup.exe`) and run it. It installs in one click and the first launch walks you through setup. Every push to `main` rebuilds and republishes it on GitHub, so there's nothing to build on your PC.

**From source:** `npm install`, then `npm start`. `npm run dist` builds the installer into `dist/`.

**Without GitHub:** `Install-Islet.bat` (a single self-contained file) builds and installs the same thing on your PC.

The installer isn't code-signed, so Windows SmartScreen may say "unknown publisher": *More info → Run anyway*.

## First run
A setup window asks what you care about. Every step is optional, and you can run it again from the tray icon (*Set up Islet…*) or Settings.
1. **Football teams.** Follow up to 6 teams across any league.
2. **Formula 1.** Pick up to 3 drivers and a team.
3. **Spotify.** Connect your account.
4. **Calendar, Claude Code, preferences.**

## Using it
Hover the notch (it swells, then opens) or click it to pin it open. Click the grabber bar or press **Ctrl+Alt+I** to pin or unpin from anywhere. Alerts, Claude activity, a music pill and a live-match pill appear on their own.

| Tab | |
|---|---|
| **Now** | Music + controls, battery, next meeting (with Join), your team's next match, your F1 driver and next session |
| **Calendar** | 7-day agenda from your `.ics` link; one-click Join for Meet, Zoom, Teams, Webex |
| **Alerts** | WhatsApp, mail and other app notifications (reads the Windows notification database, read-only) |
| **Clipboard** | Last 3 texts or screenshots; click to copy again, drag into any app |
| **Notes** | Auto-saved quick note |
| **Spotify** | Seek, like, shuffle, repeat, volume, switch device, start a playlist |
| **Football** | Fixtures, live scores and tables for the Premier League, La Liga, Serie A, Bundesliga, Ligue 1, Champions League, Europa League, MLS and Saudi Pro League |
| **F1** | Next race countdown, every session in your local time, standings, last result |

## Football data
Islet uses **API-Football** when you add a key (Settings → Football data), and **ESPN's public feed** otherwise (no key needed).

The free API-Football plan allows 100 requests a day, so Islet is frugal: tables are cached for 3 hours, fixtures for 5 minutes, and it checks your followed teams hourly when nothing is close, every 1 to 2 minutes around kick-off. It reads the remaining quota from API-Football's response headers and switches to ESPN automatically when the quota runs low, when the key is rejected, or when your plan doesn't include the current season. Followed teams are matched by name across both providers, so switching mid-match doesn't lose your alerts.

Followed teams get a live score pill while they play, and alerts for kick-off (15 minutes before and at the start), goals for and against, disallowed goals, half-time and full-time. F1 session reminders arrive 15 minutes before and at the start of each session.

## Spotify
Needs a free Spotify developer app (so your listening data only ever goes between Spotify and your PC):
1. Create an app at <https://developer.spotify.com/dashboard>.
2. Add the Redirect URI `http://127.0.0.1:47615/spotify/callback` (Spotify allows `http` only for the `127.0.0.1` loopback address, not `localhost`).
3. Paste the app's **Client ID** into Islet (setup wizard or Settings) and click **Connect**.

Islet signs in with PKCE (no client secret) and keeps the tokens encrypted with Windows DPAPI. Showing what's playing works on any account; playback controls need Spotify Premium.

## Other setup
- **Calendar:** Settings → paste your calendar's `.ics` link (Google: *Secret address in iCal format*; Outlook: *Publish a calendar* → ICS). Treat it like a password.
- **Alerts tab:** nothing to set up. Windows notifications can also be shown as pop-ups (Settings).
- **Clipboard:** text stays in memory; screenshots are temporary PNGs deleted when they fall off the list. Content password managers flag as sensitive is never recorded.
- **Claude Code:** Settings → **Connect** adds hook entries to `%USERPROFILE%\.claude\settings.json` (other settings are kept, a backup is saved). Restart Claude Code afterwards. Permission prompts can be approved from the island.
- **Your own alerts:** `POST http://127.0.0.1:47615/notify` with `{"title","body","icon","duration"}`.

## Design
Glass only on controls and navigation (tab bar, buttons, chips, segmented controls), flat content, one glass tab bar whose selection lens slides between tabs, a pointer-following specular highlight, concentric corners, spring motion, tinted prominent buttons, and iOS-style grouped settings with switches. Respects Windows' *reduce animations* and high-contrast settings. Windows can't blur the desktop behind a transparent window, so the glass is drawn as a material rather than true refraction.

Type is **Inter** (bundled, SIL Open Font License, `renderer/fonts/LICENSE-Inter.txt`), the closest open match to San Francisco, which Apple doesn't license for Windows apps.

## Development
`npm test` runs the automated tests (no Electron or Windows needed). Every push to `main` makes GitHub Actions run the tests, build `Islet-Setup.exe` on a Windows runner and publish it to a Release for the version in `package.json` (bump it for a new release).

## Known limits
- Developed without a Windows machine to hand: the logic and UI are covered by tests and screenshots, but these can only be proven on Windows: the media bridge (`media.ps1`), the notification reader (`notifications.ps1`), the Claude Code hook (`hook.ps1`), the live football/F1/Spotify services, and dragging a screenshot out of the panel. Errors show in the relevant tab.
- The Alerts tab reads an undocumented Windows database and ESPN's feed is unofficial. Either could change.
- Spotify's Web API has been changing; if a control stops working, Settings → Spotify shows the reason.
- Primary monitor only.
