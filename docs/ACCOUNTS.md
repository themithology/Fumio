# Accounts, sign-in and profiles

Sign-in is **optional**. The site and the app work fully signed out; an account
adds cross-device sync of list/history/look, and a public profile page.

## The pieces

| Piece | File | Notes |
|---|---|---|
| Firebase init | `src/firebase.js` | project `ogpb-331d5`; the web config is **public client config**, not a secret |
| Auth form | `src/components/auth/AuthForm.jsx` | email/password and Google |
| Account state | `src/components/auth/useAccount.js` | the hook every page uses |
| Native Google flow | `android/…/InAppGoogleAuth.java` | on Android, Google runs inside the app, not a browser tab |
| Profiles | `src/utils/profiles.js`, `src/pages/Profile.jsx` | handle, display name, look |
| Look (avatar/banner) | `src/utils/profileLook.js`, `src/components/account/LookEditor.jsx` | device-first, then published |
| Sync | `src/utils/accountSync.js` | list, history, look |
| API | `src/utils/dbApi.js` | `/api/db/*` on `theogpiratebot.online` |

## Signing in on our own domain

`authDomain` is **not a label** — it is the origin the Firebase sign-in helper is
loaded from (`https://<authDomain>/__/auth/handler`). Only Firebase Hosting serves
that path. So `src/config/authDomain.js` **probes** the apex
(`theogpiratebot.online`) and only uses it when it really serves the helper;
otherwise it falls back to `ogpb-331d5.firebaseapp.com`, which works today.

Turning the apex on for real requires **both**:

1. the apex connected in Firebase → Hosting, and
2. `https://theogpiratebot.online/__/auth/handler` added as an authorised
   redirect URI on the Google OAuth client.

Until then the apex is a probe, not a promise. The probe fails **towards the
working host**: an unreadable, slow, SPA-rewritten or bot-challenged response all
resolve to Firebase's own host, so nothing here can take sign-in away.

The verdict is cached for an hour (`opb:firebase-auth-domain`), so the probe does
not run on every page load.

## Android specifics

- Google sign-in must stay **inside** the WebView: the shell keeps
  `accounts.google.com`, `googleapis.com`, `gstatic.com`, `firebaseapp.com`
  and friends in-app (never sends them to Chrome) and has a native flow for the
  redirect case.
- The account API is cross-origin and does **not** send CORS headers, so the app
  calls it from **native** HTTPS (`NativeHttp`, no `Origin`) and hands the answer
  back to the page as a `fumio-native-http` event.
- Auth redirects come back through the `com.fumio.app://` scheme
  (`verify`, and the Google redirect host).

## Public profile

- `PUT /api/db/profile/<handle>` — only what the member chose to publish.
- `GET /api/db/profile/<handle>` — public read.
- The handle's owner is remembered on the device for instant UI
  (`fumio-account-owner`), and the uid the server acts on always comes from the
  session, never from a value the page sends.
- The look is validated before it is stored or published, so a hand-edited
  `localStorage` value cannot inject anything.

## What is never stored

- No password ever reaches the app (Firebase handles it).
- No device fingerprint, IMEI or MAC. The only device identifier is a **random
  UUID** (`installId`) used for the access wall.
- No analytics or crash SDK. Nothing to trace a person with.

Deleting data: the client exposes `deleteUserData()`; clearing app data wipes the
device copy. Server-side rows are deleted through the account API — see
[DATA-LAYER-PLAN.md](DATA-LAYER-PLAN.md).
