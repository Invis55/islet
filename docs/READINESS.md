# Islet: readiness for sale

Status: **not ready to sell as currently built.** The app works, and the free and personal-use path is solid. The blockers are licences for the data and integrations the sports features depend on. Engineering can't fix those; a business decision can.

This is a summary of the public terms I could find, not legal advice. Have a lawyer read the sources before you rely on any of this.

## Blockers

| Dependency | Used for | What the public terms say | Consequence for a paid app |
|---|---|---|---|
| **OpenF1** (api.openf1.org) | F1 live timing, lap data, the track map | Free and open source, and described as "unofficial", with data from F1's live timing feed. Its sponsor tier, which unlocks live data, is labelled **"PERSONAL USE"**. The site says the data is "intended solely for non-commercial analysis and fan engagement". | Live F1 can't be sold. Replays are at best a gray area. |
| **API-Football** | Football fixtures, tables and live scores | "Some sports data … may be subject to … commercial restrictions imposed by third parties, including leagues". It says the user must obtain any licences needed, and it "does not grant any commercial rights on such competitions". | A paid football feature needs league licences, which are negotiated per product. |
| **ESPN public JSON** (site.api.espn.com) | Football fallback, NBA, NFL and MLB | Undocumented and not an official API. The old ESPN developer terms barred paid apps and ads unless you had a partnership. I couldn't find current terms for these endpoints. | Shouldn't be the source for a sold product without a partnership or written permission. |
| **Spotify Web API** | Spotify controls, playlists, library | In development mode, apps are limited to 5 users, and the developer account needs Premium. Extended quota is for legally registered organisations. Commercial use of non-streaming apps is limited. | A paid app can't reach real users through this API without an approved organisation and a quota extension. |

## What is sellable now

The parts that don't depend on those services:

- **Focus timer**: Pomodoro blocks, island pill, break alerts, and held alerts.
- **Tasks**: a checklist, stored locally.
- **Now playing and media controls through Windows** (SMTC): this works with any player, including the Spotify desktop app, without the Spotify Web API.
- **Calendar**: `.ics` agenda and Join buttons.
- **Clipboard history**, notes, and Windows notification pop-ups.
- **Claude Code activity** and permission prompts.

This already fits the product direction: a productivity island for Windows, with sports as an optional add-on.

## Options

1. **Sell a productivity edition, sports as a separate add-on later.** Ship without the sports and Spotify Web API connections. The `modules` setting can turn sports off today, and the Spotify connection is optional. Add sports back once the licences exist. *Recommended.*
2. **Sell the full app after licensing.** Get written licences from API-Football (and the leagues behind it), a commercial sports-data provider for F1 and the other leagues, and a Spotify organisation account with an extended quota. Expect a recurring cost and a long lead time.
3. **Give the app away free.** It's the lowest-risk option for the sports features, but there's still no written permission from OpenF1, ESPN or API-Football, so keep the disclaimers and credits prominent.

## Engineering still needed for any paid release

- **Code signing**: an Authenticode certificate, so Windows SmartScreen doesn't warn users. Unsigned installers will scare buyers off. Cost: a yearly certificate.
- **Auto-update**: `electron-updater` with signed releases.
- **Privacy policy and consent**: the app reads the Windows notification database, the media session, and clipboard contents, and it writes to `~/.claude/settings.json` for Claude Code hooks. Each needs a clear, opt-in explanation at first run, and the app should explain how to remove it. Right now the notification and clipboard features are on by default.
- **Licence and terms**: an EULA, a privacy policy, and a refund policy. A payment provider such as Paddle or Lemon Squeezy can act as merchant of record and handle VAT and sales tax.
- **Crash and error logs**: a local log file the user can attach to a support request, with no personal data.
- **Uninstall cleanup**: remove the Claude hooks, the login item, and the stored tokens and credentials.
- **Attribution and branding**: credit each data source wherever its data appears. Remove the "F1" and "Formula 1" marks from any product name or icon unless licensed.
- **Tests on real Windows**: `media.ps1`, `notifications.ps1` and `hook.ps1` have only been tested in a sandbox. They need a real machine test pass before any sale.

## Decisions needed

1. Sell a productivity edition now (option 1), or wait for sports licences (option 2)?
2. Who is the seller: you as an individual, or a registered company? Spotify's extended quota needs a legally registered organisation.
3. Budget for a code-signing certificate and a merchant-of-record provider.
