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
  // Identify the native shell in the User-Agent, on BOTH platforms.
  //
  // A WKWebView's UA is Safari's, so the app was indistinguishable from mobile
  // Safari — Profile > Security listed a user's own Helpr app as
  // "iPhone · Safari". Someone scanning their sessions for an intrusion was
  // shown their own phone as a browser.
  //
  // SecurityTab's UA parser already had a "Helpr app" branch keyed on
  // 'capacitor' / 'helpr'. Nothing ever set either token, so the branch was
  // unreachable and the Safari branch above it always won. This is its
  // missing half; the parser is reordered to match (a WKWebView UA contains
  // BOTH tokens, so the app test has to run first).
  //
  // Top level rather than under `ios`, because the Android WebView has the
  // same problem and there is no `android` block to hang it off.
  //
  // Appended, not overridden: replacing the UA wholesale would break the
  // WebKit sniffing other libraries rely on.
  //
  // Sessions recorded BEFORE this ships keep their stored Safari UA — this
  // only corrects sessions created from here on.
  appendUserAgent: 'HelprApp',
  ios: {
    // App Store Connect identifiers
    appleId: '6754470134',
    sku: 'Helpr',
    version: '1.0.4',
    build: '5906',
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
      // Show the splash immediately and hide it as soon as React paints
      // (see src/main.tsx — the double-rAF right after createRoot().render;
      // it is deliberately NOT hidden from initNative any more). Apple HIG:
      // hide ASAP.
      // A 1.5s safety-net timeout in nativeInit.ts force-hides the splash
      // even if init fails (this comment said 4s; it was tightened and the
      // comment was not).
      //
      // NOTE that safety net hides the NATIVE splash only. If React fails to
      // mount, hiding it just reveals index.html's #boot-loader, and the app
      // sits on that forever. That is what a "loads but never opens" launch
      // looks like — see the HARD CAP note in
      // src/integrations/supabase/keychainStorageAdapter.ts.
      // launchShowDuration MUST be non-zero. Read
      // node_modules/@capacitor/splash-screen/ios/.../SplashScreen.swift:
      // `showOnLaunch()` calls buildViews() and then
      // `if config.launchShowDuration == 0 { return }` — it returns BEFORE
      // showSplash(), so the splash view is never added to the parent view
      // and `isVisible` stays false. A 0 here does not mean "show it and let
      // JS hide it"; it means the Capacitor splash NEVER APPEARS AT ALL, and
      // hide() is then a no-op too (`if !isVisible { return }`).
      //
      // That is exactly the bug the owner reported on TestFlight: the iOS
      // LaunchScreen storyboard covered the pre-WebView phase, then was torn
      // down the instant the WebView's view controller appeared, revealing
      // the app already mid-load. No branded splash, ever.
      //
      // With launchAutoHide:false the showDuration value is otherwise unused
      // (SplashScreen.swift only arms the auto-hide timer when autoHide is
      // true), so this number is just "non-zero" — the splash stays up until
      // src/main.tsx hides it at first paint, with the 1.5s safety net in
      // src/lib/nativeInit.ts as the backstop.
      launchShowDuration: 500,
      launchAutoHide: false,
      backgroundColor: '#F1F2F4', // COOL parchment — the exact hex of hsl(220 14% 95%), i.e. --parchment in index.css. Matches StatusBar (below) and index.html's theme-color. The #root/#boot-loader shell and the app's page ground both paint the diagonal champagne gradient (#F7F8FA -> #EDEFF3); this flat value sits between those two endpoints, so the splash-to-WebView handoff stays within a couple of RGB units instead of flashing a different surface.
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
