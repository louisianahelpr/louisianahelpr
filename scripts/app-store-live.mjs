#!/usr/bin/env node
/**
 * `npm run launch:appstore` — is the App Store listing live, and does the repo
 * say so? (docs/OPEN.md Q1289, docs/LAUNCH_CHECKLIST.md "Launch day".)
 *
 * READ ONLY. Probes Apple for the apple_id in fastlane/ios_app_metadata.yml
 * (the App Store Connect record) and compares with src/lib/appStore.ts and
 * index.html. Changes nothing; prints the exact edits when it is time.
 *
 * Exit codes:
 *   0  live-and-shipped: Apple lists the app and the repo already shows it
 *   1  not-live: Apple does not list it yet (the expected answer before launch)
 *   2  flip-now: Apple lists it and the repo still hides it; the steps follow
 *   3  inconsistent: ids disagree, or the repo shows links Apple does not serve
 *
 *   npm run launch:appstore            report
 *   npm run launch:appstore -- --json  machine-readable
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readAppleId, readBundleId, readRepoState, judgeAppStore } from "./lib/appStoreLive.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(resolve(REPO, p), "utf8");
const json = process.argv.includes("--json");

const meta = read("fastlane/ios_app_metadata.yml");
const appleId = readAppleId(meta);
const bundleId = readBundleId(meta);
const repo = readRepoState(read("src/lib/appStore.ts"), read("index.html"));

async function probe(url, asJson) {
  try {
    const res = await fetch(url, { redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (launch:appstore)" } });
    return asJson ? { status: res.status, body: await res.json() } : { status: res.status };
  } catch (e) {
    return { status: 0, error: e instanceof Error ? e.message : "fetch failed" };
  }
}

const page = appleId ? await probe(`https://apps.apple.com/us/app/id${appleId}`, false) : null;
const lk = appleId ? await probe(`https://itunes.apple.com/lookup?id=${appleId}&country=us`, true) : null;
const lookup = lk && lk.status === 200 ? lk.body : null;

const result = judgeAppStore({ appleId, bundleId, repo, page, lookup });
const code = { "live-and-shipped": 0, "not-live": 1, "flip-now": 2, inconsistent: 3 }[result.verdict];

if (json) {
  console.log(JSON.stringify({ appleId, bundleId, repo, page, lookupCount: lookup?.resultCount ?? null, ...result }, null, 2));
} else {
  console.log(`launch:appstore  apple_id ${appleId ?? "?"}  bundle ${bundleId ?? "?"}`);
  console.log(`  Apple page  https://apps.apple.com/us/app/id${appleId}  -> HTTP ${page?.status ?? "-"}${page?.error ? ` (${page.error})` : ""}`);
  console.log(`  Apple lookup resultCount ${lookup?.resultCount ?? `unreadable (HTTP ${lk?.status ?? "-"})`}`);
  console.log(`  repo        APP_STORE_LISTING_LIVE=${repo.listingLive}  APP_STORE_URL id ${repo.urlId ?? "?"}  banner ${repo.bannerId ?? "absent"}`);
  console.log(`VERDICT: ${result.verdict}`);
  for (const p of result.problems) console.log(`  ✗ ${p}`);
  if (result.verdict === "not-live") console.log("  Apple does not list the app yet. Nothing to change; re-run once App Review approves and the app is released.");
  result.steps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
}
process.exit(code);
