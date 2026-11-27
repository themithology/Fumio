# When the site will not load

The screen a viewer sees when `theogpiratebot.to` is unreachable: **"Something
went wrong — join our socials for updates"**, with Discord, Telegram and Instagram
on its own card, and two buttons (**Try again**, **Browse offline**).

It is bundled in the APK (`android/app/src/main/assets/offline.html`) and rendered
in a WebView placed on top of the activity's content frame
(`OfflineScreen.java`), so it works with **zero network**.

## Why a WebView and not native views

On a television the remote reaches the screen through `TvPointer`, which taps
whatever **WebView** it is aimed at. A page made of `<button>`s is therefore
clickable with the arrow exactly like the site is — no second input path to keep
alive. `MainActivity.keyTarget()` returns the offline WebView while the screen is
up, and `TvPointer.retarget()` points the arrow at it; closing the screen points
the arrow back at the browse page.

## Triggers

| Trigger | Where |
| --- | --- |
| Main-frame load error on the live site | `MainActivity` → `onReceivedError` |
| Main-frame HTTP ≥ 500 from the live site (a dead backend answers 502/503/504, and `onReceivedError` never fires for that) | `onReceivedHttpError` |
| 30 s watchdog: the live site still has not painted | `armLoadWatchdog()`, armed at launch and on every retry |
| The bundled copy itself fails to paint | `onReceivedError`, own origin |

The old behaviour — silently swap in the built-in copy — is gone. On a dead
network that copy loads its shell but every rail is empty, because the API is
unreachable; saying so and offering the copy as a *choice* is the honest version.
"Browse offline" is exactly that old path (`localAppUrl`).

## It says why

The screen prints the failure in small type under the subtitle — *"DNS lookup
failed"*, *"Connection refused"*, *"Timed out"*, *"Server returned HTTP 502"*,
*"No answer within 30 seconds"*. A user's screenshot then **is** a usable bug
report, which matters because that is the only diagnostic we ever get.

`MainActivity.describeError()` maps the WebView error code to plain words;
`OfflineScreen` passes it to the page through `window.FumioOfflineReason()`.

## It retries by itself

`MainActivity` registers a default-network callback. If the screen is up because
there was no connection, the app retries the live site the moment the connection
returns, instead of waiting for someone to press **Try again**. The callback does
nothing unless the screen is showing.

## Behaviour

* Page: `file:///android_asset/offline.html`, JavaScript enabled, **network loads
  blocked** (`setBlockNetworkLoads`), no zoom, no scrollbars, no long-press.
* Brand marks: official [simple-icons](https://simpleicons.org) paths, Discord
  `#5865F2`, Telegram `#26A5E4`, Instagram brand gradient.
* Social links open in the **system browser / app** (`Intent.ACTION_VIEW`), never
  inside the WebView.
* **BACK** closes the screen before it closes the app.
* The screen never covers a playing video (`playerActive` is checked).
* On `onDestroy` the overlay is torn down and the pointer state released.

## Links (verbatim, do not "improve")

```
https://discord.gg/t6tjszp5eb
https://t.me/+Jlk7wxnZJZtlOTQ1
https://www.instagram.com/theogpiratebot
```

## Checked without a device

`node /tmp/tvtest/offline.check.cjs` (jsdom): three cards, three exact URLs, three
official `path` payloads, and the three buttons call the bridge (`open`, `retry`,
`browse`). jsdom has no layout, so the **visual** result on a television is still
unverified — first thing to look at on the next install.
