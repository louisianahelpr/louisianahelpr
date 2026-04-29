import type { CapacitorConfig } from '@capacitor/cli';

// iOS/Android load the live production app by default so users receive web
// updates immediately without a new native build. Local dev hot-reload can
// still override this with CAP_DEV_URL=https://<sandbox>.lovableproject.com
// before `npx cap sync`.
const rawDevUrl = process.env.CAP_DEV_URL;
const devServerUrl =
  rawDevUrl && /^https:\/\/[^/]+\.(lovableproject|lovable)\.(app|dev)/.test(rawDevUrl)
    ? rawDevUrl
    : undefined;
const appServerUrl = devServerUrl ?? 'https://louisianahelpr.com';
if (rawDevUrl && !devServerUrl) {
  // eslint-disable-next-line no-console
  console.warn(
    `[capacitor.config] Ignoring CAP_DEV_URL="${rawDevUrl}" — only Lovable sandbox URLs are allowed. Using production URL instead.`,
  );
}

const config: CapacitorConfig = {
  // App Store Connect record — locked to this exact value.
  appId: 'com.Helpr',
  appName: 'Louisiana Helpr',
  webDir: 'dist',
  server: { url: appServerUrl, cleartext: false },
  ios: {
    // App Store Connect identifiers
    appleId: '6754470134',
    sku: 'Helpr',
    version: '1.0.4',
    build: '17',
    category: 'public.app-category.lifestyle',
    supportUrl: 'https://louisianahelpr.com/support',
    privacyPolicyUrl: 'https://www.louisianahelpr.com/privacy',
    marketingUrl: 'https://www.louisianahelpr.com',
    // Allow iPad multitasking (Split View / Slide Over). Set to true to lock full screen.
    contentInset: 'always',
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
      backgroundColor: '#FFFFFF', // Matches the uploaded Helpr splash/logo canvas
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
      overlaysWebView: false
    },
    Keyboard: {
      // KeyboardResize.Body — body shrinks so focused inputs stay visible above the keyboard.
      resize: 'body',
      style: 'LIGHT',
      resizeOnFullScreen: true
    }
  }
};

export default config;
