// Mint a Supabase session for the two E2E test accounts via service-role magic link.
// Allowlist is the whole safety model — these two addresses only.
import fs from "node:fs";
const env = Object.fromEntries(fs.readFileSync(new URL("../.env", import.meta.url), "utf8")
  .split("\n").filter(l => l.includes("=")).map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]));
const URL_ = env.VITE_SUPABASE_URL, SR = env.SUPABASE_SERVICE_ROLE_KEY;
const ALLOW = { poster: "helpr-e2e-poster-0902@mailinator.com", helper: "helpr-e2e-helper-0902@mailinator.com" };
const role = process.argv[2];
const email = ALLOW[role];
if (!email) { console.error("usage: mint.mjs poster|helper"); process.exit(1); }

const gen = await fetch(`${URL_}/auth/v1/admin/generate_link`, {
  method: "POST",
  headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json" },
  body: JSON.stringify({ type: "magiclink", email }),
});
const link = await gen.json();
if (!gen.ok) { console.error("generate_link failed", gen.status, JSON.stringify(link)); process.exit(1); }
const verify = await fetch(`${URL_}/auth/v1/verify?token=${link.hashed_token}&type=magiclink`, {
  headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY }, redirect: "manual",
});
const loc = verify.headers.get("location") || "";
const frag = new URLSearchParams(loc.split("#")[1] || "");
const access_token = frag.get("access_token"), refresh_token = frag.get("refresh_token");
if (!access_token) { console.error("no token in", loc); process.exit(1); }
const userRes = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${access_token}` } });
const user = await userRes.json();
const projectRef = URL_.split("//")[1].split(".")[0];
console.log(JSON.stringify({
  key: `sb-${projectRef}-auth-token`,
  value: JSON.stringify({ access_token, refresh_token, expires_at: Math.floor(Date.now()/1000)+3600, expires_in: 3600, token_type: "bearer", user }),
  email, user_id: user.id,
}));
