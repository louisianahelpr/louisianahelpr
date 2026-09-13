/**
 * Real prod sessions for audits (owner, 2026-09-12: "no mock mode ever").
 *
 * Mints a session for each shared test account through
 * scripts/test-signin-link.mjs (service role, magic link, no password typed),
 * caches it on disk for 40 minutes so a sweep doesn't mint per screen, and
 * resolves the real ids the sweep's route catalog used to fake.
 *
 * A session is injected by writing the Supabase auth key into localStorage
 * before the app boots, exactly as scripts/audit/walk-every-control.mjs does.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { BrowserContext } from "@playwright/test";

export type TestAccount = "poster-e2e" | "helper-e2e";

export interface ProdSession {
  key: string;
  value: string;
  userId: string;
  accessToken: string;
}

const CACHE_DIR = resolve(process.cwd(), "test-results/.prod-sessions");
const TTL_MS = 40 * 60 * 1000;

export function prodSession(account: TestAccount): ProdSession {
  mkdirSync(CACHE_DIR, { recursive: true });
  const file = resolve(CACHE_DIR, `${account}.json`);
  if (existsSync(file)) {
    const cached = JSON.parse(readFileSync(file, "utf8")) as ProdSession & { at: number };
    if (Date.now() - cached.at < TTL_MS) return cached;
  }
  const raw = JSON.parse(
    execSync(`node scripts/test-signin-link.mjs ${account} --session --json`, { encoding: "utf8", maxBuffer: 1 << 24 }),
  ) as { key: string; value: string; session?: { user?: { id?: string }; access_token?: string } };
  const parsed = JSON.parse(raw.value) as { user?: { id?: string }; access_token?: string };
  const s: ProdSession = {
    key: raw.key,
    value: raw.value,
    userId: raw.session?.user?.id ?? parsed.user?.id ?? "",
    accessToken: raw.session?.access_token ?? parsed.access_token ?? "",
  };
  if (!s.userId || !s.accessToken) throw new Error(`could not read user id / token from the ${account} session`);
  writeFileSync(file, JSON.stringify({ ...s, at: Date.now() }));
  return s;
}

export async function injectProdSession(context: BrowserContext, s: ProdSession): Promise<void> {
  await context.addInitScript(([k, v]) => {
    try {
      localStorage.setItem(k, v);
      localStorage.setItem("helpr_onboarding", JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }));
    } catch { /* storage blocked: the screen will show signed-out, and the sweep reports it */ }
  }, [s.key, s.value]);
}

/** Read-only REST select as a test account (for resolving real ids). */
export async function prodSelect<T>(s: ProdSession, pathAndQuery: string): Promise<T> {
  const url = process.env.VITE_SUPABASE_URL ?? readEnv("VITE_SUPABASE_URL");
  const anon = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? readEnv("VITE_SUPABASE_PUBLISHABLE_KEY") ?? readEnv("VITE_SUPABASE_ANON_KEY");
  const res = await fetch(`${url}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: anon ?? "", Authorization: `Bearer ${s.accessToken}` },
  });
  if (!res.ok) throw new Error(`prodSelect ${pathAndQuery}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

function readEnv(name: string): string | undefined {
  const f = resolve(process.cwd(), ".env");
  if (!existsSync(f)) return undefined;
  const m = new RegExp(`^${name}=(.*)$`, "m").exec(readFileSync(f, "utf8"));
  return m?.[1]?.replace(/^["']|["']$/g, "");
}
