// Compile-time feature flags. Toggle these to mount/unmount UI that
// depends on work landing in other parts of the stack (native code,
// backend migrations, third-party config, etc.).
//
// Keep flags here rather than in env vars when the gate is "is the
// dependency installed yet?" rather than "is this user in a cohort?".
// Cohort flags live in PostHog.

/**
 * Mounts the Alternate App Icon picker on the Profile → Settings tab.
 *
 * Dormant until cowork's Mac-side Xcode wiring lands. Specifically,
 * this stays `false` until:
 *   1. The AppIcon-Fleur PNG set is added to ios/App/App/Assets.xcassets/
 *      (generated via `node scripts/generate-ios-icons.mjs` from
 *      public/app-icon-alt.svg).
 *   2. The CFBundleAlternateIcons + CFBundleIcons keys are re-added
 *      to ios/App/App/Info.plist (they were removed in commit d6be7b4
 *      because the PNGs weren't wired in and the missing references
 *      were crashing iOS app launch).
 *   3. @capacitor-community/native-app-icon is installed and pod-installed
 *      on the Mac (npm install + npx cap sync ios).
 *
 * Flip to `true` in the same PR that completes those three steps.
 */
export const APP_ICON_PICKER_ENABLED = false;
