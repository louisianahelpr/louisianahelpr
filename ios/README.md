# iOS Native Setup — Helpr

This folder contains the committed iOS Xcode project and native config that
Fastlane/GitHub/Xcode use directly. The App Store Connect identity is locked
to `com.Helpr`, SKU `Helpr`, Apple ID `6754470134`, Team `P85MCK558V`.

## First-time setup (on your Mac)

```bash
git pull
npm install
npx cap add ios
npx cap sync ios
```

After each pull, build and sync the native shell:

```bash
# App icon — generate all 18 sizes from the 1024 source
node scripts/generate-ios-icons.mjs

npm run build
npx cap sync ios
```

Then in Xcode:
1. Open `ios/App/App.xcworkspace`
2. Verify Bundle ID is `com.Helpr`
3. Verify Team is `P85MCK558V — Helpr, LLC`
4. Verify Signing & Capabilities already lists Push Notifications, Sign in with Apple, Associated Domains, and Background Modes → Remote notifications
5. Build and run on iPhone 15 simulator to verify

> **Push tokens only register on real devices.** The simulator will
> never call back into `useNativePushSetup()` — test on a real iPhone
> after a TestFlight build.

## Push notifications

The `@capacitor/push-notifications` plugin is already installed and
auto-linked by CocoaPods on `npx cap sync ios` — no Podfile edits needed.

The entitlements file (`ios/App.entitlements`) declares:
- `aps-environment = production` — works for both TestFlight and App Store
- `applinks:*.louisianahelpr.com` — Universal Links (matches
  `public/.well-known/apple-app-site-association`)

Runtime registration, token storage in `push_tokens`, foreground
handling, and tap-to-deep-link are all wired in `src/lib/nativePush.ts`
and mounted from `src/App.tsx` via `useNativePushSetup()`.


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
