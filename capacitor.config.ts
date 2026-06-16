import type { CapacitorConfig } from '@capacitor/cli';

// TRUE NATIVE APP: iOS/Android load the bundled `dist/` folder shipped
// inside the .ipa/.apk. NO `server.url` — the app is fully self-contained
// and is NOT a web wrapper. To ship updates: run `npm run build:ios &&
// npx cap sync ios`, then archive a new build in Xcode for TestFlight.
//
// Local dev hot-reload (optional, dev only): set CAP_DEV_URL=https://<sandbox>.lovableproject.com
// before `npx cap sync`. This is stripped for production builds.
const rawDevUrl = process.env.CAP_DEV_URL;
const devServerUrl =
  rawDevUrl && /^https:\/\/[^/]+\.(lovableproject|lovable)\.(app|dev)/.test(rawDevUrl)
    ? rawDevUrl
    : undefined;
if (rawDevUrl && !devServerUrl) {
  console.warn(
    `[capacitor.config] Ignoring CAP_DEV_URL="${rawDevUrl}" — only Lovable sandbox URLs are allowed.`,
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
    build: '19',
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
    // Info.plist keys — source-of-truth reminder for the committed native file.
    // These values are already present in ios/App/App/Info.plist so GitHub →
    // Xcode/Fastlane builds populate automatically without manual Xcode entry.
    // Apple will reject the build if camera / location / photo / contacts
    // permissions are requested without matching usage strings.
    //
    //   <key>NSCameraUsageDescription</key>
    //   <string>Helpr needs camera access so you can take before/after photos of jobs and upload your ID for verification.</string>
    //   <key>NSLocationWhenInUseUsageDescription</key>
    //   <string>Helpr uses your location to show jobs near you and confirm helper arrival.</string>
    //   <key>NSPhotoLibraryUsageDescription</key>
    //   <string>Allows you to upload photos from your library to show job details and progress.</string>
    //   <key>NSPhotoLibraryAddUsageDescription</key>
    //   <string>Allows Helpr to save downloaded receipts and shared images to your photo library.</string>
    //   <key>NSContactsUsageDescription</key>
    //   <string>Helpr can access contacts only if you choose to invite a friend by phone or email.</string>
    //   <key>ITSAppUsesNonExemptEncryption</key>
    //   <false/>
    //   <key>UIRequiresFullScreen</key>
    //   <false/>
    //   NOTE: Do NOT set UIStatusBarStyle / UIViewControllerBasedStatusBarAppearance
    //   in Info.plist. The Capacitor StatusBar plugin owns this at runtime
    //   (see plugins.StatusBar below + src/lib/nativeInit.ts). Mixing both
    //   leads to the bar flickering between styles on launch.
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
      backgroundColor: '#F4F8F5', // Matches StatusBar.backgroundColor below so cold-start doesn't flash cream→sage as the splash hands off to the WebView
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
      // Helpr's default surface is the cream #F4F8F5, so we want dark icons.
      // Per-screen overrides live in src/hooks/useStatusBar.ts.
      style: 'LIGHT',
      backgroundColor: '#F4F8F5',
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
    SocialLogin: { providers: { google: true, apple: true } }
  }
};

export default config;
