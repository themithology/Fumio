# Installing the APK on a TV

The app is delivered as a plain APK (`theogpiratebot-apk-<n>` release). Android
TV has no app store in this setup, so pick one of these. **`adb` is by far the
easiest** — a remote is not a keyboard.

## 1. Enable developer mode on the TV

Per-vendor menus differ, but the path is always:

1. Settings → **About** (or Device Preferences → About).
2. Highlight **Build** and press the centre button **7 times** — "You are now a
   developer".
3. Settings → **Developer options** → enable **USB debugging** (and **Wireless
   debugging** if your box has it; Fire TV calls it "ADB debugging").

## 2. Install

### Over the network (wireless debugging)
```bash
adb pair 192.168.1.42:37821      # code shown on the TV, Android 11+
adb connect 192.168.1.42:5555    # IP shown in Developer options
adb install -r app-debug.apk     # -r = replace, keeps data
```

### Over USB
```bash
adb devices          # accept the "Allow debugging?" prompt on the TV
adb install -r app-debug.apk
```

### Without a computer
1. Download the APK on a phone.
2. Put it on a USB stick (or use "Send files to TV"-style app).
3. On the TV, open a file manager, pick the APK, install. You will need to allow
   **Install unknown apps** for that file manager.

## 3. Launching

The app appears on the TV home screen as its own tile (banner + leanback
launcher entry). It is the same package as the phone app (`com.fumio.app`).

## 4. Updates

Inside the app, an update prompt appears when a newer release exists (checked at
most every 6 hours). It downloads into the app cache and hands the file to the
system installer — the TV's own "Install?" screen, never silent. Downloads,
resume points and settings survive because every build is signed with the same
key (`android/app/fumio-release.p12`).

If you prefer the manual route: `adb install -r` the new APK. Same result.

> **One-time exception:** the first build signed with the committed key
> (2026-11 onwards) has a different signature from all older builds, so it needs
> one uninstall first — which clears app data. After that, updates install over
> the top.

## 5. When something looks wrong

- **Blank screen on launch, remote does nothing** → press BACK once, then MENU
  (the app logs a `FumioTvSelfTest` line with candidate counts and per-direction
  move results).
- **The site looks tiny or zoomed** → the TV reported an odd density; the
  viewport normalisation should prevent it. Report the box model and the
  `FumioTvSelfTest` numbers.
- **Something on screen will not select** (a card, a filter, a "more" chevron) →
  press **MENU**. The remote becomes a pointer; move it with the D-pad and press
  OK to click. **BACK** returns to D-pad.
- **A server does not play** → try another server in the picker. The list is the
  website's; a dead host is a website-side problem, not an APK one.
