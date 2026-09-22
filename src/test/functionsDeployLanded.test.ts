/**
 * functions-deploy reported SUCCESS over eight edge-function deploys that
 * never reached production.
 *
 * Run 35756822730 (2026-09-22, deploy-all) printed, for all 73 functions:
 *
 *     Deploying Function: create-pro-checkout (script size: 839 kB)
 *     Deployed Functions on project ***: create-pro-checkout
 *     ✓ create-pro-checkout deployed
 *
 * and concluded success. Prod kept serving `create-pro-checkout` version 87
 * from 2026-09-07 and `claim-gift-card` version 3 from 2026-09-13 — the latter
 * without the `payment_status` funding gate that landed that same morning in
 * 61fe256d2, so a refunded gift card stayed claimable. A second, single-function
 * run (35757178581) re-uploaded create-pro-checkout, reported success again, and
 * was discarded again.
 *
 * The workflow's only test of success was the CLI's exit code, which says
 * nothing about prod. The cases below are built from that run's REAL hashes and
 * REAL log lines: the first one is red against a check that trusts the exit
 * code, and green only against one that reads the project back.
 *
 * The two mutations restore the two halves of the original bug. The first makes
 * the hash comparison accept an unchanged artifact — exactly what "the CLI said
 * it worked" amounted to. The second makes every uploaded function look deduped,
 * which empties the inventory and is the other way a check like this goes
 * vacuous: it passes because it is asserting on nothing.
 *
 * @mutate scripts/verify-functions-deployed.mjs |     if (a === b) lost.push(slug); |     if (false) lost.push(slug);
 * @mutate scripts/verify-functions-deployed.mjs | for (const m of deployLog.matchAll(/Deploying Function:\s*([a-z0-9][a-z0-9-]*)/g)) { | for (const m of []) {
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
// @ts-expect-error — plain .mjs helper shared with the deploy workflow
import { verifyDeploys, uploadedFunctions, dedupedFunctions } from "../../scripts/verify-functions-deployed.mjs";

const REPO = path.resolve(__dirname, "..", "..");
const WORKFLOW = path.join(REPO, ".github", "workflows", "functions-deploy.yml");

/**
 * Verbatim shape of run 35756822730's "Deploy each function" output, trimmed to
 * the functions this test reasons about. `create-pro-checkout` and
 * `claim-gift-card` were uploaded and lost; `check-pro-subscription` was
 * uploaded and landed; `instant-job-match` was deduped by the CLI.
 */
const REAL_DEPLOY_LOG = [
  "##[group]Deploying check-pro-subscription",
  "Bundling Function: check-pro-subscription",
  "Deploying Function: check-pro-subscription (script size: 851 kB)",
  "Deployed Functions on project ***: check-pro-subscription",
  "✓ check-pro-subscription deployed",
  "##[group]Deploying claim-gift-card",
  "Bundling Function: claim-gift-card",
  "Deploying Function: claim-gift-card (script size: 798 kB)",
  "Deployed Functions on project ***: claim-gift-card",
  "✓ claim-gift-card deployed",
  "##[group]Deploying create-pro-checkout",
  "Bundling Function: create-pro-checkout",
  "Deploying Function: create-pro-checkout (script size: 839 kB)",
  "Deployed Functions on project ***: create-pro-checkout",
  "✓ create-pro-checkout deployed",
  "##[group]Deploying instant-job-match",
  "No change found in Function: instant-job-match",
  "Deployed Functions on project ***: instant-job-match",
  "✓ instant-job-match deployed",
].join("\n");

// Real ezbr_sha256 values read off the project on 2026-09-22.
const SHA = {
  proCheckoutStuck: "cd254b542065f5fc5d2c9e4a91425c44e45caeb32705428ed5e6c8554bd69a49",
  giftClaimStuck: "e23e4c55b5b553ff5315399b075e08ecdce27af24c1b2563f18c22fb85b8b604",
  checkProBefore: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  checkProAfter: "607c37b522199adcd62e821b03d8800aa6160dc68a9d6802f04d56e7bc7f5bfd",
  instantMatch: "97f8b7a6194807f0210dad1bed96d9eda3293c8cb07c6ce1fc0f5337f9791cbf",
};

const listing = (entries: Array<[string, string]>) => ({
  functions: entries.map(([slug, ezbr_sha256]) => ({ slug, ezbr_sha256, status: "ACTIVE" })),
});

const TARGETS = [
  "check-pro-subscription",
  "claim-gift-card",
  "create-pro-checkout",
  "instant-job-match",
];

describe("verifyDeploys — a green deploy must mean prod actually changed", () => {
  it("fails the run when an uploaded function's stored bundle never moved", () => {
    // Exactly what the project looked like before and after run 35756822730.
    const before = listing([
      ["check-pro-subscription", SHA.checkProBefore],
      ["claim-gift-card", SHA.giftClaimStuck],
      ["create-pro-checkout", SHA.proCheckoutStuck],
      ["instant-job-match", SHA.instantMatch],
    ]);
    const after = listing([
      ["check-pro-subscription", SHA.checkProAfter],
      // Unchanged — the two uploads the platform accepted and discarded.
      ["claim-gift-card", SHA.giftClaimStuck],
      ["create-pro-checkout", SHA.proCheckoutStuck],
      ["instant-job-match", SHA.instantMatch],
    ]);

    const result = verifyDeploys({ before, after, deployLog: REAL_DEPLOY_LOG, targets: TARGETS });

    expect(result.ok).toBe(false);
    expect(result.lost).toEqual(["claim-gift-card", "create-pro-checkout"]);
    // The one that really landed must not be swept up in the accusation.
    expect(result.verified).toContain("check-pro-subscription");
  });

  it("does not accuse a function the CLI deduped rather than uploaded", () => {
    // instant-job-match's hash is identical before and after BY DESIGN: the CLI
    // built the same bundle and skipped the upload. Treating that as a loss
    // would make this check red on every ordinary run, i.e. useless.
    const same = listing([["instant-job-match", SHA.instantMatch]]);
    const result = verifyDeploys({
      before: same,
      after: same,
      deployLog: "No change found in Function: instant-job-match",
      targets: ["instant-job-match"],
    });

    expect(result.ok).toBe(true);
    expect(result.lost).toEqual([]);
    expect(result.deduped).toEqual(["instant-job-match"]);
  });

  it("passes when every uploaded function's bundle advanced", () => {
    const before = listing([
      ["check-pro-subscription", SHA.checkProBefore],
      ["claim-gift-card", SHA.giftClaimStuck],
      ["create-pro-checkout", SHA.proCheckoutStuck],
      ["instant-job-match", SHA.instantMatch],
    ]);
    const after = listing([
      ["check-pro-subscription", SHA.checkProAfter],
      ["claim-gift-card", "1111111111111111111111111111111111111111111111111111111111111111"],
      ["create-pro-checkout", "2222222222222222222222222222222222222222222222222222222222222222"],
      ["instant-job-match", SHA.instantMatch],
    ]);

    const result = verifyDeploys({ before, after, deployLog: REAL_DEPLOY_LOG, targets: TARGETS });

    expect(result.ok).toBe(true);
    expect(result.lost).toEqual([]);
    expect(result.verified).toEqual([
      "check-pro-subscription",
      "claim-gift-card",
      "create-pro-checkout",
    ]);
  });

  it("fails when a targeted function vanishes from the deploy log entirely", () => {
    // Not uploaded, not deduped — the log stopped saying what happened to it.
    // An inventory that can no longer be derived is not an inventory.
    const same = listing([["create-pro-checkout", SHA.proCheckoutStuck]]);
    const result = verifyDeploys({
      before: same,
      after: same,
      deployLog: "Deployed Functions on project ***: create-pro-checkout",
      targets: ["create-pro-checkout"],
    });

    expect(result.ok).toBe(false);
    expect(result.unaccounted).toEqual(["create-pro-checkout"]);
  });

  it("treats a brand-new function's first appearance as evidence, not a loss", () => {
    const result = verifyDeploys({
      before: listing([]),
      after: listing([["stalled-completion-reminder", "abc"]]),
      deployLog: "Deploying Function: stalled-completion-reminder (script size: 12 kB)",
      targets: ["stalled-completion-reminder"],
    });

    expect(result.ok).toBe(true);
    expect(result.verified).toEqual(["stalled-completion-reminder"]);
  });

  it("reads the uploaded/deduped inventory out of the CLI's own words", () => {
    expect([...uploadedFunctions(REAL_DEPLOY_LOG)].sort()).toEqual([
      "check-pro-subscription",
      "claim-gift-card",
      "create-pro-checkout",
    ]);
    expect([...dedupedFunctions(REAL_DEPLOY_LOG)]).toEqual(["instant-job-match"]);
  });
});

describe("the guard is actually mounted in CI", () => {
  // A verifier nothing calls is decoration. Anchored on the script path and on
  // the behaviour (the deploy output must be captured for it to read), never on
  // indentation or step names, which get reworded.
  const workflow = fs.readFileSync(WORKFLOW, "utf8");

  it("functions-deploy.yml runs the verifier", () => {
    expect(workflow).toContain("scripts/verify-functions-deployed.mjs");
  });

  it("captures the deploy output the verifier has to read", () => {
    expect(workflow).toMatch(/\|\s*tee\s+(?:-\S+\s+)*\S*deploy\S*\.log/);
  });

  it("snapshots the project before AND after the deploy", () => {
    const snapshots = workflow.match(/api\.supabase\.com\/v1\/projects\/[^/\s]+\/functions/g) ?? [];
    expect(snapshots.length).toBeGreaterThanOrEqual(2);
  });

  it("does not let any step render its own failure green", () => {
    // A `continue-on-error:` key would restore the exact defect this guard
    // closes: a red outcome reported green. Comments are stripped first — a
    // guard that trips on the prose explaining it is a guard that goes inert
    // the moment someone rewords the prose.
    const code = workflow
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n");
    expect(code).not.toMatch(/continue-on-error\s*:/);
  });
});
