# Documentation index

Start here, then follow the one document that matches what you are doing.

## By task

| I want to… | Read |
|---|---|
| build and run anything | [../SETUP.md](../SETUP.md) |
| understand how the pieces fit | [ARCHITECTURE.md](ARCHITECTURE.md) |
| change a page, a rail or a server source | [WEBSITE.md](WEBSITE.md) |
| work on the Android shell, the bridge or the updater | [ANDROID.md](ANDROID.md) |
| touch the player, servers, downloads | [PLAYER.md](PLAYER.md) |
| touch auth, profiles, sync | [ACCOUNTS.md](ACCOUNTS.md) · [DATA-LAYER-PLAN.md](DATA-LAYER-PLAN.md) |
| add/repair `GET /api/players` on the site | [iris-players-endpoint.md](iris-players-endpoint.md) |
| work on television behaviour | [TV.md](TV.md) · [TV-CONTRACT.md](TV-CONTRACT.md) |
| know why a TV bug happened | [TV-AUDIT.md](TV-AUDIT.md) |
| install or update on a set | [TV-INSTALL.md](TV-INSTALL.md) |
| change the "site is down" screen | [OFFLINE-SCREEN.md](OFFLINE-SCREEN.md) |
| run the tests, or know what can't be run | [TESTING.md](TESTING.md) |
| see what shipped in which APK | [CHANGELOG.md](CHANGELOG.md) |
| read an old plan | [archive/](archive/) |

## The five rules every change is checked against

1. **The browser keeps being the browser.** If the website can do it, the app
   does not re-implement it.
2. **Nothing hardcoded that the owner edits.** Server lists come from the site at
   runtime; a bundled list is a fallback, never the normal path.
3. **A website deploy must not need an APK, and an APK must not break the site.**
4. **Nothing TV-only may run on a phone** — it all hangs off `TvMode.isTv()`.
5. **The app owns only four things**: the player, downloads, the access wall and
   the updater (plus the cursor on a TV).

## Conventions

- Docs describe **what exists**, in the present tense, with file paths. Plans are
  archived, not left in the main tree.
- Numbers that were chosen by feel (speeds, zooms, press times) are listed in
  [TV.md](TV.md#feel) so they can be argued with in one place.
- Anything unverified on hardware is labelled as such, in
  [TESTING.md](TESTING.md#what-cannot-be-tested-here--check-on-the-device).
