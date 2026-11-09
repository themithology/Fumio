# The data layer — every key, cap and merge rule

Where a user's data actually lives, so nobody has to guess. Everything here was
read off the code, not from memory.

## 1. On the device (works with no account and no network)

### `localStorage` in the WebView

| Key | Written by | Contents | Cap |
|---|---|---|---|
| `myList` | `src/utils/myList.js` | saved titles | **100** (`MY_LIST_CAP`) |
| `continueWatching` | `src/utils/watchHistory.js` | resume trail | **10** (`HISTORY_CAP`) |
| `iris-profile-look` | `src/utils/profileLook.js` | avatar / banner choice | — |
| `iris-profile-look-at` | same | timestamp, for last-edit-wins across devices | — |
| `fumio-account-owner` | `src/utils/accountSync.js` | which uid this device belongs to | — |
| `fumio-account-stash:<uid>` | same | a signed-out member's local copy, kept until the same uid signs in again | — |
| `fumio-account-sync` | same | sync state flag | — |
| `firebase:authUser:…` | Firebase SDK | cached session | — |
| `opb:firebase-auth-domain` | `src/config/authDomain.js` | which sign-in host answered the probe | 1 h TTL |
| `preferredServerKey` | player | the chosen server (applied to whatever list arrives) | — |
| `animeQualityOnly` | anime player | quality preference | — |

### `SharedPreferences` in the app

| File / key | Contents |
|---|---|
| `ogpb_verify` → `install_id` | a random UUID, generated once. The only device identifier in the product |
| `ogpb_verify` → `until_wall`, `server_at`, `local_at` | the 12-hour access window |
| `ogpb_live_sources` | cached live server lists, keyed `type|id|season|episode`, **6 h** TTL |
| updater prefs | last offer, last download |

### Files

Downloads go to the public **Downloads** folder (fallback: app-private files dir).
`DownloadsLibrary` keeps the index and resume positions.

## 2. On the server — only for signed-in members

| Endpoint | Direction | Payload |
|---|---|---|
| `PUT /api/db/user/<uid>` | up | `{ myList, continueWatching, look, updatedAt }` |
| `GET /api/db/user/<uid>` | down | the same |
| `DELETE /api/db/user/<uid>` | up | removes the row (`deleteUserData`) |
| `PUT /api/db/profile/<handle>` | up | the published page |
| `GET /api/db/profile/<handle>` | down | the public page |
| `GET /api/db/handle/<uid>` | down | a member's own handle |
| `GET /api/db/profiles?q=…` | down | profile search |
| `/api/verify/start`, `/api/verify/redeem`, `/api/verify/entitlement` | up | `{ installId, code? }` |

The account API sends **no CORS headers**, which is why the Android app calls it
from native HTTPS (`NativeHttp`, no `Origin`) and hands the answer back to the
page as a `fumio-native-http` event.

## 3. Merge rules (why two devices do not clobber each other)

- **Writes are debounced** 2.5 s (`WRITE_DEBOUNCE_MS`) so a scan through a rail
  is one write, not thirty.
- **Progress is pushed at most once a minute** (`PROGRESS_PUSH_MS`).
- **Titles merge, not arrays**: for each title, the copy with the newer timestamp
  wins, so device A's episode 4 and device B's episode 6 both survive as "6".
- **Look merges by timestamp** (`iris-profile-look-at`), newest edit wins — the
  whole reason that second key exists.
- **Signing out keeps the local copy** in `fumio-account-stash:<uid>`, and signing
  back in as the same uid merges it back rather than discarding it.
- A failed sync never throws at the user: the local copy is already correct, and
  the next write retries.

## 4. Privacy summary (what is *not* collected)

- No analytics SDK, no crash-reporting SDK, no ad SDK in the app.
- No password stored anywhere by the app (Firebase handles it).
- No device fingerprint: the only identifier is the random `installId`.
- Signed out, nothing leaves the device except ordinary page requests.
- A public profile is **opt-in and off by default**; it carries a display name,
  the titles on the list, and the last watched title — never the email, never the
  full history, never the uid.

## 5. The access wall

- 12 hours from a successful redeem; verified against `/api/verify/entitlement`.
- Keyed by `installId`, so re-installing is a new window (that is accepted).
- The clock is checked against **server** time (`server_at` vs `local_at`), so
  changing the device date does not extend a window.
- Phones see it; **televisions never do** (the prefetch is skipped on TV too, so
  a TV makes no verify request at all).

## 6. Deleting data

| Want | Do |
|---|---|
| Wipe this device | clear the app's data (Settings → App → Storage → Clear) — list, history, look, downloads index |
| Delete the account row | `deleteUserData(uid)` through the account API (server-side, Iris) |
| Delete a published profile | unpublish through the account screen, then delete the row server-side |
