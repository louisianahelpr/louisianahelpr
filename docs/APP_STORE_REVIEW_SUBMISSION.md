# App Store Review Submission — Build 18 (CFBundleVersion 2030)

Ready-to-paste copy for App Store Connect when submitting build 18 for App Store review. Submission gated on TestFlight smoke-test passing (Apple+Google native sign-in, push token registration, Keychain-backed session survival).

## What's New in This Version

```
Native Sign in with Apple and Google — tap the buttons in the sign-in screen and you'll get the system-native sheet (Face ID / Google account picker) instead of a Safari hand-off. Faster, fewer taps.

Push notifications — we now register your device for push on first sign-in. You'll get notified when a job offer lands, when a payout clears, and when an admin needs your attention.

Logins survive low-memory iOS conditions — sessions are now mirrored to iOS native storage, so you stay logged in even after iOS reclaims memory or you offload the app and reinstall later.

Location pre-prompt — we now explain why we ask for location before iOS shows the system permission dialog.
```

## Reviewer Notes (App Information → Notes)

```
Louisiana Helpr is a service marketplace for southern Louisiana. Every account can both POST jobs (as a customer) and APPLY to jobs (as a helper) — there is no separate role or account switch. The demo account below can exercise both sides.

Demo account credentials are set in App Store Connect → App Information → Sign-In Information.

The demo account's identity/verification is pre-approved so it can post and apply immediately. It does not have any jobs already posted or applied to — to see the full flow, post a job (bottom nav → Post) and separately apply to one of the open jobs already visible in Browse. Stripe is in test mode for this account; no real charges.

Notes for the reviewer:
- Location and push notification permissions are required for the core flow.
- Sign in with Apple and Google both work natively. The demo email/password also works.
- After signing in, the home screen shows nearby open jobs — no separate mode or role switch is needed to apply to one.
```

## Age Rating

4+ — confirmed. No mature content; user-generated content moderated by admin review pre-publish.

## Screenshots

Reuse 1.0.4 (17) screenshots unless they no longer reflect the UI. Reshoot #4 (Sign in screen) to show the new native Apple/Google buttons.

1. Home — nearby open jobs map view
2. Job details
3. Apply flow
4. Sign in (NEW for build 18, native buttons visible)
5. Earnings dashboard

## Export Compliance

Standard iOS APIs only (HTTPS, Keychain Services, Security framework). Already attested via Info.plist (`ITSAppUsesNonExemptEncryption=false`).

## Submission Checklist

- [ ] TestFlight smoke-test of build 18 passes
- [ ] Demo account creds confirmed in ASC
- [ ] Screenshot #4 reshot (native buttons visible)
- [ ] What's New copy pasted
- [ ] Reviewer Notes pasted
- [ ] Manual release toggle set (do not auto-release)
- [ ] Click Submit to App Review
