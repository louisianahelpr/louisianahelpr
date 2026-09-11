import fs from "node:fs";
import { chromium } from "playwright";

export const BASE = "http://localhost:8347";
export const SHOTS = process.env.HOME + "/lh-audit-shots/e2e-loop";
fs.mkdirSync(SHOTS, { recursive: true });

export const env = Object.fromEntries(
  fs.readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")
    .filter(l => l.includes("=")).map(l => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }));

export const SB = env.VITE_SUPABASE_URL;
export const SR = env.SUPABASE_SERVICE_ROLE_KEY;
export const ANON = env.VITE_SUPABASE_PUBLISHABLE_KEY;

/** Ground truth. Service role only — never the client under test. */
export async function sql(query) {
  const r = await fetch(`${SB}/rest/v1/rpc/exec_audit_sql`, { method: "POST" }).catch(() => null);
  throw new Error("use restQ instead");
}
export async function restQ(path) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: { apikey: SR, Authorization: `Bearer ${SR}` } });
  const b = await r.text();
  if (!r.ok) throw new Error(`REST ${path} -> ${r.status} ${b}`);
  return JSON.parse(b);
}
export async function restWrite(method, path, body) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    method, headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${t}`);
  return t ? JSON.parse(t) : [];
}

const session = (role) => JSON.parse(fs.readFileSync(new URL(`./sess-${role}.json`, import.meta.url), "utf8"));

export async function launch() {
  return chromium.launch({ headless: true });
}

/** A signed-in context with the onboarding tour pre-suppressed. */
export async function persona(browser, role, { width = 375, height = 812 } = {}) {
  const s = session(role);
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  await ctx.addInitScript(([k, v]) => {
    localStorage.setItem(k, v);
    localStorage.setItem("helpr_onboarding", JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }));
  }, [s.key, s.value]);
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.log(`  [${role} console.error] ${m.text().slice(0, 200)}`); });
  page.userId = s.user_id;
  page.role = role;
  return { ctx, page, userId: s.user_id, email: s.email };
}

/** Toasts vanish fast — poll immediately after the action. */
export async function grabToasts(page, ms = 6000) {
  const seen = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const texts = await page.$$eval("[data-sonner-toast]", (ns) => ns.map((n) => n.innerText.replace(/\s+/g, " ").trim())).catch(() => []);
    for (const t of texts) if (t) seen.add(t);
    await page.waitForTimeout(150);
  }
  return [...seen];
}

let shotN = 0;
export async function shot(page, name) {
  const f = `${SHOTS}/${String(++shotN).padStart(3, "0")}-${name}.png`;
  await page.screenshot({ path: f, fullPage: false });
  console.log(`  shot ${f}`);
  return f;
}
export function log(...a) { console.log(...a); }
