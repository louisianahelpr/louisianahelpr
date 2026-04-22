# iOS Native Setup — Helpr

This folder contains iOS-specific config files that get copied into the
real `ios/` Xcode project on `npx cap sync`. The actual `ios/App/...`
Xcode project is generated **locally on your Mac** and is gitignored.

## First-time setup (on your Mac)

```bash
git pull
npm install
npx cap add ios
npx cap sync ios
```

After `npx cap add ios`, copy these files into the Xcode project:

```bash
# Privacy manifest (REQUIRED since iOS 17 — Apple will reject without it)
cp ios/PrivacyInfo.xcprivacy ios/App/App/PrivacyInfo.xcprivacy

# App icon — generate all 18 sizes from the 1024 source
node scripts/generate-ios-icons.mjs
```

Then in Xcode:
1. Open `ios/App/App.xcworkspace`
2. Drag `PrivacyInfo.xcprivacy` into the App target → "Copy items if needed"
3. Verify it appears under **App target → Build Phases → Copy Bundle Resources**
4. Drag the generated `AppIcon.appiconset` folder into `Assets.xcassets`,
   replacing the placeholder
5. Bundle ID: confirm `com.Helpr` matches App Store Connect record
6. Signing & Capabilities: select your team
7. Build and run on iPhone 15 simulator to verify

## Splash screen

Capacitor uses `capacitor.config.ts` `SplashScreen` plugin config + the
`AppIcon.appiconset` for the launch image. The 1024×1024 icon is reused
as the splash logo on a `#1FA678` background.

## Bundle ID

`com.Helpr` is registered in App Store Connect under Apple ID `6754470134`.
**Do not change this value** — it must match the App Store Connect record
exactly or signing will fail.

## Permissions

All `NS*UsageDescription` strings live in `capacitor.config.ts` under
`ios.content`. They are injected into Info.plist on `npx cap sync`.

Edit them in one place — never edit Info.plist directly, since `cap sync`
will overwrite changes.

## Required-reason APIs

Declared in `PrivacyInfo.xcprivacy`:
- `NSPrivacyAccessedAPICategoryUserDefaults` — reason CA92.1
- `NSPrivacyAccessedAPICategoryFileTimestamp` — reason C617.1
- `NSPrivacyAccessedAPICategorySystemBootTime` — reason 35F9.1
- `NSPrivacyAccessedAPICategoryDiskSpace` — reason E174.1

If you add a third-party SDK that uses additional required-reason APIs,
add them here and re-submit.

## Production build (for App Store)

```bash
# Build the web bundle (no dev server URL)
npm run build

# Sync to native — production has NO server.url block, so the app
# loads bundled dist/ assets and Apple won't reject under Guideline 4.2
npx cap sync ios

# Open in Xcode and Archive → upload to App Store Connect
npx cap open ios
```

## Local hot-reload (for development only)

```bash
# Point the app at the live Lovable preview
CAP_DEV_URL=https://215189c5-272d-4716-babd-430ab4187c14.lovableproject.com npx cap sync ios
npx cap run ios
```

**Never ship a build with `CAP_DEV_URL` set.** Production must be self-contained.
