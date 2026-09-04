#!/usr/bin/env node
/**
 * Creates (or repairs) the App Store review demo account.
 *
 * The credentials on file in fastlane/metadata/review_information/ named an
 * account that did not exist in auth.users at all — a reviewer typing them
 * would just get a login failure. This script creates it via the GoTrue
 * admin API (a raw INSERT into auth.users would need to hand-hash the
 * password and stamp every internal column GoTrue expects; the admin API is
 * the supported way to do this), then completes the Big-7 profile fields so
 * ProtectedRoute never bounces the reviewer to /complete-profile, approves
 * the account, and marks identity verification as passed so the reviewer can
 * actually post a job and message a helper without hitting the Stripe
 * Identity wall.
 *
 * Idempotent: safe to re-run. If the user already exists, this updates the
 * password and profile state instead of failing.
 *
 * Usage: node scripts/create-app-review-demo-account.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function loadEnv() {
  const envPath = path.join(repoRoot, ".env");
  const text = fs.readFileSync(envPath, "utf8");
  const env = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = loadEnv();
const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const EMAIL = fs
  .readFileSync(path.join(repoRoot, "fastlane/metadata/review_information/demo_user.txt"), "utf8")
  .trim();
const PASSWORD = fs
  .readFileSync(path.join(repoRoot, "fastlane/metadata/review_information/demo_password.txt"), "utf8")
  .trim();

const adminHeaders = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};

async function findExistingUser(email) {
  const res = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
    { headers: adminHeaders },
  );
  if (!res.ok) throw new Error(`list users failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  return (body.users || []).find((u) => u.email?.toLowerCase() === email.toLowerCase()) || null;
}

async function createUser(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { app_review_demo: true },
    }),
  });
  if (!res.ok) throw new Error(`create user failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function updateUserPassword(userId, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ password, email_confirm: true }),
  });
  if (!res.ok) throw new Error(`update user failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function restQuery(table, params) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
    headers: adminHeaders,
  });
  if (!res.ok) throw new Error(`REST GET ${table} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function restUpdate(table, filter, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: "PATCH",
    headers: { ...adminHeaders, Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`REST PATCH ${table} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function restInsert(table, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...adminHeaders, Prefer: "return=representation,resolution=merge-duplicates" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`REST POST ${table} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  console.log(`Target: ${EMAIL}`);
  let user = await findExistingUser(EMAIL);
  if (!user) {
    console.log("No existing auth user — creating.");
    user = await createUser(EMAIL, PASSWORD);
    console.log(`Created auth user ${user.id}`);
  } else {
    console.log(`Existing auth user ${user.id} — resetting password to match fastlane metadata.`);
    await updateUserPassword(user.id, PASSWORD);
  }

  const userId = user.id;

  // complete-signup normally creates this row server-side. Since this account
  // never went through real signup, upsert it directly with every Big-7
  // field populated so ProtectedRoute's completeness gate never fires, plus
  // the approval/IDV state a reviewer needs to actually use the app.
  const profileRows = await restQuery("profiles", `user_id=eq.${userId}&select=user_id`);
  const profilePayload = {
    user_id: userId,
    email: EMAIL,
    full_name: "App Review",
    // Points at the brand-asset edge function rather than a storage object —
    // it is a real, always-live 200 image/png (used by every email template),
    // so this is a genuine picture the reviewer sees rendered, not a dead
    // link that happens to satisfy the completeness gate's non-null check.
    avatar_url: "https://fncmgoasalhdgfwzhsqa.supabase.co/functions/v1/brand-asset",
    date_of_birth: "1990-01-01",
    phone: "5045550100",
    location: "New Orleans, LA",
    zip_code: "70112",
    parish: "Orleans",
    approval_status: "approved",
    ban_status: "active",
    // Two similarly-named columns exist (`idv_status` is the one the actual
    // gate — post-a-job, accept-an-offer — reads; `id_verification_status` is
    // an older/parallel column some surfaces still check). Set both so
    // neither path can leave the reviewer blocked.
    idv_status: "verified",
    id_verification_status: "verified",
    stripe_identity_verified: true,
    terms_version_accepted: "Jun 2026",
    is_seed: true,
  };
  if (profileRows.length === 0) {
    console.log("No profiles row — inserting.");
    await restInsert("profiles", profilePayload);
  } else {
    console.log("Existing profiles row — updating to reviewer-ready state.");
    await restUpdate("profiles", `user_id=eq.${userId}`, profilePayload);
  }

  const prefRows = await restQuery(
    "notification_preferences",
    `user_id=eq.${userId}&select=user_id`,
  );
  if (prefRows.length === 0) {
    await restInsert("notification_preferences", { user_id: userId });
  }

  console.log("\nDone. Reviewer can sign in with:");
  console.log(`  email:    ${EMAIL}`);
  console.log(`  password: ${PASSWORD}`);
  console.log(
    "\nThis account is approved, IDV-verified, and profile-complete — it can post a job",
  );
  console.log(
    "and message a helper without hitting the Stripe Identity gate. It has no Stripe",
  );
  console.log("Connect account, so it cannot be HIRED as a helper — only act as a poster.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
