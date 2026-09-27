/**
 * CLASS CHECK: the test harness, scripts and edge functions never mint a
 * signed storage URL meant to outlive the page view (2026-09-27).
 *
 * noPersistedSignedUrls.test.ts holds this line for src/ and only for
 * `createSignedUrl(path, ttl)`. It could not see the other two ways to mint
 * one: the raw REST call `POST /storage/v1/object/sign/<bucket>/<path>` with
 * `{ expiresIn }`, and anything outside src/.
 *
 * FOUND 2026-09-27. Seed job c9a6a3a0-870b-4706-aef6-b9ee5a57aa27 (created
 * 2026-09-26) held signed URLs in proof_before_urls and proof_after_urls on
 * prod, two days after the app itself moved to storing paths. The writer was
 * scripts/e2e/settleForward.mjs `uploadProof`, which signed for 365 days and
 * returned the URL for the row. It now returns the path.
 *
 * Same rule as the src/ guard: a token signed for a day or more is a token
 * being kept, so it is refused. Shown red on the old settleForward.mjs.
 *
 * @mutate scripts/e2e/settleForward.mjs |   return path; |   return void ["/object/sign/", { expiresIn: 60 * 60 * 24 * 365 }], path;
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const REPO = resolve(__dirname, "..", "..");
const ROOTS = ["e2e", "scripts", "supabase/functions"];
const DISPLAY_TTL_CEILING = 60 * 60 * 24;

function files(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) files(abs, out);
    else if (/\.(m?[jt]s|tsx)$/.test(entry)) out.push(abs);
  }
  return out;
}

const PRODUCT = String.raw`((?:\d+\s*\*\s*)*\d+)`;
const REST_TTL = new RegExp(String.raw`expiresIn\s*:\s*` + PRODUCT, "g");
const SDK_TTL = new RegExp(String.raw`createSignedUrls?\(\s*[^,()]+,\s*` + PRODUCT + String.raw`\s*\)`, "g");

const seconds = (expr: string) => expr.split("*").reduce((a, n) => a * Number(n.trim()), 1);

/** Every literal signing TTL in a file that signs storage objects. */
function literalTtls(): { file: string; seconds: number }[] {
  const out: { file: string; seconds: number }[] = [];
  for (const root of ROOTS) {
    for (const abs of files(join(REPO, root))) {
      const src = readFileSync(abs, "utf8");
      const file = relative(REPO, abs);
      if (src.includes("createSignedUrl")) {
        for (const m of src.matchAll(SDK_TTL)) out.push({ file, seconds: seconds(m[1]) });
      }
      if (src.includes("/object/sign/")) {
        for (const m of src.matchAll(REST_TTL)) out.push({ file, seconds: seconds(m[1]) });
      }
    }
  }
  return out;
}

describe("the harness never mints a signed URL meant to be stored", () => {
  const ttls = literalTtls();

  it("reads the signing calls it claims to read (not vacuous)", () => {
    // 2 on 2026-09-27: prod-lifecycle.spec.ts (600s, display-time check) and
    // the message-attachments authz probe (60s).
    expect(ttls.length).toBeGreaterThanOrEqual(2);
  });

  it("no literal signing TTL is a day or more", () => {
    const long = ttls.filter((t) => t.seconds >= DISPLAY_TTL_CEILING).map((t) => `${t.file}: ${t.seconds}s`);
    expect(long, "store the storage PATH and sign at display time").toEqual([]);
  });
});
