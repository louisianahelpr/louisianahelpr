/**
 * Build-only stand-in for @supabase/auth-js's GoTrueAdminApi (B87, 11-01).
 *
 * GoTrueClient builds one in its constructor (`auth.admin`), so the whole admin API (users, invites, links, OAuth
 * clients, custom providers, factors, passkeys: 1.4 KB gz) rode in the supabase chunk every page boots with. The
 * admin API needs the service-role key, which never ships in the app: the only method a browser client calls is
 * signOut, which GoTrueClient's own signOut uses to end the session on the server. This keeps that method, copied
 * from auth-js 2.117.3 unchanged; every other admin call refuses. vite.config.ts (plugin "auth-js-no-passkeys")
 * swaps it in for the build only; dev and tests keep the real module.
 *
 * Guard: src/test/authJsAdminStubKeepsSignOut.test.ts (the copy matches the installed package's signOut).
 */
import { _request } from "@supabase/auth-js/dist/module/lib/fetch";
import { resolveFetch } from "@supabase/auth-js/dist/module/lib/helpers";
import { SIGN_OUT_SCOPES } from "@supabase/auth-js/dist/module/lib/types";
import { isAuthError } from "@supabase/auth-js/dist/module/lib/errors";

type Fetch = typeof fetch;
type Scope = (typeof SIGN_OUT_SCOPES)[number];

const adminOnly = (): never => {
  throw new Error("The Supabase admin API needs the service-role key; it is not part of the app.");
};

export default class GoTrueAdminApi {
  url: string;
  headers: Record<string, string>;
  fetch: Fetch;
  experimental: Record<string, unknown>;
  mfa = { listFactors: adminOnly, deleteFactor: adminOnly };
  oauth = { listClients: adminOnly, createClient: adminOnly, getClient: adminOnly, updateClient: adminOnly, deleteClient: adminOnly, regenerateClientSecret: adminOnly };
  customProviders = { listProviders: adminOnly, createProvider: adminOnly, getProvider: adminOnly, updateProvider: adminOnly, deleteProvider: adminOnly };
  passkey = { listPasskeys: adminOnly, deletePasskey: adminOnly };

  constructor({ url = "", headers = {}, fetch, experimental }: { url?: string; headers?: Record<string, string>; fetch?: Fetch; experimental?: Record<string, unknown> }) {
    this.url = url;
    this.headers = headers;
    this.fetch = resolveFetch(fetch);
    this.experimental = experimental ?? {};
  }

  async signOut(jwt: string, scope: Scope = SIGN_OUT_SCOPES[0]) {
    if (SIGN_OUT_SCOPES.indexOf(scope) < 0) {
      throw new Error(`@supabase/auth-js: Parameter scope must be one of ${SIGN_OUT_SCOPES.join(', ')}`);
    }
    try {
      await _request(this.fetch, 'POST', `${this.url}/logout?scope=${scope}`, {
        headers: this.headers,
        jwt,
        noResolveJson: true,
      });
      return { data: null, error: null };
    }
    catch (error) {
      if (isAuthError(error)) {
        return { data: null, error };
      }
      throw error;
    }
  }
}
