import type { CapacitorConfig } from '@capacitor/cli';

// TRUE NATIVE APP: iOS/Android load the bundled `dist/` folder shipped
// inside the .ipa/.apk. NO `server.url` — the app is fully self-contained
// and is NOT a web wrapper. To ship updates: run `npm run build:ios &&
// npx cap sync ios`, then archive a new build in Xcode for TestFlight.
//
// Local dev hot-reload (optional, dev only): set CAP_DEV_URL=https://<host>
// before `npx cap sync`. This is stripped for production builds.
const rawDevUrl = process.env.CAP_DEV_URL;
const devServerUrl =
  rawDevUrl && /^https:\/\/[^/]+/.test(rawDevUrl) ? rawDevUrl : undefined;
if (rawDevUrl && !devServerUrl) {
  console.warn(
    `[capacitor.config] Ignoring CAP_DEV_URL="${rawDevUrl}" — must be an https URL.`,
  );
}

const config: CapacitorConfig = {
  // App Store Connect record — locked to this exact value.
  appId: 'com.Helpr',
  appName: 'Louisiana Helpr',
  webDir: 'dist',
  // Only set `server` when a dev sandbox URL is explicitly provided.
  // Production builds have NO server block → loads bundled dist/.
  ...(devServerUrl ? { server: { url: devServerUrl, cleartext: false } } : {}),
  ios: {
    // App Store Connect identifiers
    appleId: '6754470134',
    sku: 'Helpr',
    version: '1.0.4',
    build: '4806',
    category: 'public.app-category.lifestyle',
    supportUrl: 'https://louisianahelpr.com/support',
    privacyPolicyUrl: 'https://www.louisianahelpr.com/privacy',
    marketingUrl: 'https://www.louisianahelpr.com',
    // Safe-area insets are handled entirely in CSS via env(safe-area-inset-*)
    // in our headers/shells (PageHeader, AppShell, DashboardHeader, AuthShell…).
    // 'always' made WKWebView ALSO inset scrollable content for the safe area,
    // double-counting against that CSS padding — the ~100px dead band above
    // document-scroll pages (PostJob, Profile, Activity, Legal). 'never' lets
    // the CSS env() padding be the single source of truth for the inset.
    contentInset: 'never',
    // -------------------------------------------------------------------------
    // Info.plist reference — current values are committed in
    // ios/App/App/Info.plist. NSUsageDescription strings are maintained in
    // fastlane/ios_app_metadata.yml (permission_strings block) and synced by
    // `npm run sync:ios-metadata`. Edit them there, not here.
    //
    // Key structural entries for reference:
    //   <key>ITSAppUsesNonExemptEncryption</key>
    //   <false/>
    //   <key>UIRequiresFullScreen</key>
    //   <false/>
    //   NOTE: Do NOT set UIStatusBarStyle in Info.plist — a static style value
    //   conflicts with the Capacitor StatusBar plugin's runtime setStyle calls
    //   (see plugins.StatusBar below + src/lib/nativeInit.ts) and causes the
    //   status bar to flicker between styles on launch.
    //   UIViewControllerBasedStatusBarAppearance IS set to <false/> in
    //   Info.plist, which is required for the StatusBar plugin to control the
    //   bar via UIApplication on older iOS versions.
    //   <key>UISupportedInterfaceOrientations</key>
    //   <array><string>UIInterfaceOrientationPortrait</string></array>
    //   <key>UISupportedInterfaceOrientations~ipad</key>
    //   <array>
    //     <string>UIInterfaceOrientationPortrait</string>
    //     <string>UIInterfaceOrientationPortraitUpsideDown</string>
    //     <string>UIInterfaceOrientationLandscapeLeft</string>
    //     <string>UIInterfaceOrientationLandscapeRight</string>
    //   </array>
    //   <key>LSApplicationQueriesSchemes</key>
    //   <array><string>tel</string><string>mailto</string><string>sms</string></array>
    // -------------------------------------------------------------------------
  },
  plugins: {
    SplashScreen: {
      // Show the splash immediately and hide it as soon as React mounts
      // (see src/lib/nativeInit.ts → initNative). Apple HIG: hide ASAP.
      // A 4s safety-net timeout in nativeInit.ts guarantees the splash
      // never hangs even if init fails.
      launchShowDuration: 0,
      launchAutoHide: false,
      backgroundColor: '#F1F2F4', // COOL parchment — the exact hex of hsl(220 14% 95%), i.e. --parchment in index.css. Matches StatusBar (below), index.html's theme-color and the #root FCP shell, so cold-start never flashes a mismatched tint as splash hands off to the WebView.
      //
      // This comment used to read "Warm parchment (hsl(36 16% 91%))" while the
      // value beside it was already cool. That is how P2 happened the first
      // time: the value moved and the comment did not, so the mismatch it was
      // written to prevent went unnoticed because the comment said it couldn't.
      // If --parchment changes again, this hex and index.html's theme-color
      // both have to move with it — neither can read a CSS variable.
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true
    },
    StatusBar: {
      // Capacitor semantics (counter-intuitive but correct):
      //   Style.Light => dark icons (for LIGHT backgrounds — what we want here)
      //   Style.Dark  => light icons (for DARK backgrounds)
      // Helpr's default surface is the light canvas (#F1F2F4), so we want dark icons.
      // Per-screen overrides live in src/hooks/useStatusBar.ts.
      style: 'LIGHT',
      backgroundColor: '#F1F2F4',
      // overlaysWebView is **Android-only** in @capacitor/status-bar. On
      // Android, true (the plugin default) makes the WebView render
      // edge-to-edge under the status bar; the existing
      // env(safe-area-inset-top) padding in our headers (PageHeader,
      // AppShell, DashboardHeader, AuthShell, DashboardGuest, etc.) then
      // correctly pushes content below the status bar. Has no effect on
      // iOS — iOS edge-to-edge is the native default and is controlled by
      // App.entitlements / Info.plist. Per Android docs, this setting
      // also has no effect on Android 16+ where edge-to-edge is enforced.
      //
      // Lexi originally reported a "double padding" band above iOS headers
      // (Build #20 screenshot). That turned out to be the welcome-card
      // greeting taking too much vertical space, not a real
      // safe-area-inset double-count. The welcome card was shrunk in this
      // same PR. If real iOS safe-area issues surface in future builds,
      // they need a different fix (probably auditing the per-screen
      // safe-pt usage, not StatusBar config).
      overlaysWebView: true
    },
    Keyboard: {
      // KeyboardResize.Body — body shrinks so focused inputs stay visible above the keyboard.
      resize: 'body',
      style: 'LIGHT',
      resizeOnFullScreen: true,
    },
    // Explicitly disable unused providers so the plugin's configure-dependencies.js
    // script marks them compileOnly (affects Android Gradle + CocoaPods iOS builds).
    // The plugin's SPM Package.swift unconditionally includes facebook-ios-sdk —
    // a separate upstream fix is needed there, but setting false here documents
    // intent and is correct for the Android and CocoaPods paths.
    SocialLogin: { providers: { google: true, apple: true, facebook: false, twitter: false } }
  }
};

export default config;
