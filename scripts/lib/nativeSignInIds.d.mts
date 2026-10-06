export interface SourcedId {
  id: string;
  from: string;
}
export interface SignInSources {
  socialAuth: string;
  capacitor: string;
  pbxproj: string;
  infoPlist: string;
}
export interface SignInIds {
  appleServiceIds: SourcedId[];
  bundleIds: SourcedId[];
  googleNative: SourcedId[];
  googleWeb: SourcedId[];
  providers: Record<string, boolean>;
  problems: string[];
  /** SOCIAL_SIGN_IN_ENABLED read from src/lib/socialAuth.ts (Q1462: false for launch). */
  socialEnabled: boolean;
}
export interface ConfigCheck {
  ok: boolean;
  check: string;
  detail: string;
}
export const SIGN_IN_SOURCES: SignInSources;
export const OLD_DESKTOP_GOOGLE_PREFIX: string;
export function readSignInSources(root: string): SignInSources;
export function deriveSignInIds(src: SignInSources, blank?: (s: string) => string): SignInIds;
export function idList(value: unknown): string[] | null;
export function checkAuthConfig(config: Record<string, unknown>, ids: SignInIds): ConfigCheck[];
