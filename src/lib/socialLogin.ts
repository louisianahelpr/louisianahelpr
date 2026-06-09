// Back-compat shim. The actual implementation now lives in
// src/lib/socialAuth.ts — it exposes a richer result-based API
// (signInWithProvider) plus structured cancel/error handling that the
// SocialAuthButtons component depends on.
//
// Keep this file for the few existing imports of nativeAppleSignIn /
// nativeGoogleSignIn / initSocialLogin (notably src/lib/nativeInit.ts and
// the vitest suite at ./socialLogin.test.ts).
export {
  initSocialLogin,
  nativeAppleSignIn,
  nativeGoogleSignIn,
} from "./socialAuth";
