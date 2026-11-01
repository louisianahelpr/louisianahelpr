/**
 * Build-only stand-in for @supabase/auth-js's lib/webauthn and lib/web3/ethereum (B86, 11-01).
 *
 * GoTrueClient imports both statically, so passkey sign-in (WebAuthn) and Sign-In with Ethereum rode in the
 * supabase chunk every page boots with: 4.2 KB gzip that Helpr never runs. Helpr signs in with email, Apple and
 * Google, and its two-factor is TOTP (TwoFactorCard), whose challenge/verify path never reaches these helpers.
 * vite.config.ts (plugin "auth-js-no-passkeys") swaps these in for the build only; dev and tests keep the real
 * modules. If Helpr ever adds passkeys or wallet sign-in, delete the plugin.
 *
 * Every export GoTrueClient imports is here (a missing one fails the build). Each one that would start a passkey
 * or wallet ceremony throws; browserSupportsWebAuthn() says no, so the client's own passkey methods return their
 * "not supported" error before calling anything else.
 *
 * Guard: src/test/authJsPasskeyStubMatchesImports.test.ts.
 */
const unsupported = (): never => {
  throw new Error("Passkeys and wallet sign-in are not part of Helpr.");
};

export const browserSupportsWebAuthn = (): boolean => false;
export const createCredential = unsupported;
export const getCredential = unsupported;
export const deserializeCredentialCreationOptions = unsupported;
export const deserializeCredentialRequestOptions = unsupported;
export const serializeCredentialCreationResponse = unsupported;
export const serializeCredentialRequestResponse = unsupported;
export const webAuthnAbortService = {
  createNewAbortSignal: (): AbortSignal => new AbortController().signal,
  cancelCeremony: (): void => {},
};
export class WebAuthnApi {
  // GoTrueClient builds one in its constructor (`mfa.webauthn`); Helpr never calls it.
  constructor(_client: unknown) {}
  enroll = unsupported;
  challenge = unsupported;
  verify = unsupported;
  authenticate = unsupported;
  register = unsupported;
}

// lib/web3/ethereum
export const createSiweMessage = unsupported;
export const fromHex = unsupported;
export const getAddress = unsupported;
export const toHex = unsupported;
