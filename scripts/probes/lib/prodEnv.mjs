// Shared prod-probe plumbing: .env reader, service-role REST, seed sessions.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export function readEnv() {
  const env = {};
  for (const line of readFileSync(join(REPO, ".env"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = readEnv();
export const URL_ = env.VITE_SUPABASE_URL;
export const ANON = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SR = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_?.includes("fncmgoasalhdgfwzhsqa")) throw new Error(`unexpected project ${URL_}`);

export async function rest(path, { method = "GET", body, prefer } = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

export function session(account) {
  const out = execFileSync("node", [join(REPO, "scripts/test-signin-link.mjs"), account, "--session", "--json"], { encoding: "utf8" });
  return JSON.parse(out.slice(out.indexOf("{"))).session;
}

export async function invoke(fn, token, body) {
  const res = await fetch(`${URL_}/functions/v1/${fn}`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}
