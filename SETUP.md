# Build and run — all three parts

From a plain copy of this folder (a zip, a clone, anything).
Node 20+ for the web build; the Android SDK only if you want to build the APK
locally (CI builds it otherwise).

| Part | Folder | What it is | Document |
|---|---|---|---|
| Website / app web layer | `src/`, `public/`, `index.html` | React 19 + Vite. The site **and** the web build the app loads. | [docs/WEBSITE.md](docs/WEBSITE.md) |
| Android / Android TV | `android/` | Capacitor 7 shell, package `com.fumio.app`: own player, downloads, offline screen, updater, TV cursor | [docs/ANDROID.md](docs/ANDROID.md) |
| TMDB proxy | `worker/` | Cloudflare Worker — the only place a real secret lives | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |

---

## 1. The website

```bash
npm install
npm run dev            # http://localhost:5173
npm run build          # production build into dist/
npm run lint
```

**No `.env` is required.** Every `VITE_*` variable has a working default in code;
[`.env.example`](.env.example) lists them all and what each overrides. Nothing
secret is in the client.

## 2. The APK

```bash
npm install
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

Or just push a commit: `.github/workflows/android-apk.yml` builds it and attaches
it to release `theogpiratebot-apk-<run number>`.

Two things the updater depends on — do not change them casually:

1. **`versionCode` comes from `OGPB_VERSION_CODE`** (CI sets it to the run number).
   A local build without it gets `1` and simply never offers an update.
2. **Every APK is signed with `android/app/fumio-release.p12`** (alias `fumio`).
   A build signed with a different key will not install over the existing app —
   it has to be uninstalled first, which wipes downloads and settings.

`android/app/src/main/assets/offline.html` is the "Something went wrong" screen.
It is bundled on purpose — it is the one page that cannot be fetched when it is
needed — and CI fails the build if it is missing.

## 3. The TMDB proxy (optional)

```bash
cp worker/.dev.vars.example worker/.dev.vars    # then add TMDB_API_KEY
npm run worker:dev                              # http://127.0.0.1:8787 (workerd)
npm run worker:deploy                           # your own workers.dev subdomain
```

With no key and no worker, the site falls back to the proxy ladder compiled into
`src/lib/proxyTiers.js`, so it still works.

## 4. Tests

```bash
npm install --prefix /tmp/tvtest jsdom
NODE_PATH=/tmp/tvtest/node_modules node docs/tv-ui.test.cjs           # 45 checks
NODE_PATH=/tmp/tvtest/node_modules node docs/offline-screen.test.cjs  # the offline screen
```

Neither needs a television; neither can prove how anything *looks* on one. What is
and is not covered: [docs/TESTING.md](docs/TESTING.md).

---

## What is not in a zip of this repo, and why

| Missing | Why |
|---|---|
| `node_modules/` | `npm install` recreates it exactly from `package-lock.json` |
| `dist/` | `npm run build` recreates it |
| `.git/` | history lives on GitHub (`themithology/Fumio`) |
| `.env` | **there is none, and none is needed** — see above |
| `worker/.dev.vars` | your TMDB key; copy the `.example` |

## Credentials in this repo

`android/app/fumio-release.p12` is committed **on purpose**: this app ships as a
direct APK, there is no store identity to protect, and a key kept in a CI secret
is a key somebody forgets to set — which would make every release unable to
install over the last one, wiping user downloads. The trade-off, stated plainly:
anyone with the repo can sign an APK that installs over ours. For a sideloaded
build that is the same risk as "anyone can build the app".

Store password / alias: see `android/app/build.gradle` (`signingConfigs`).
