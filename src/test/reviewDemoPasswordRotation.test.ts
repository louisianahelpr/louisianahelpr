/**
 * Q1790: the App Store reviewer's demo password is rotated by
 * scripts/rotate-review-demo-password.mjs, only after Apple decides on the
 * build under review, without ever printing the password, and without a step
 * that can lose it (the secret is stored before the account changes).
 * The Fastfile stages the secret into the temporary upload copy only.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { rotate, refusal, REVIEWER_EMAIL } from "../../scripts/rotate-review-demo-password.mjs";

// @mutate scripts/rotate-review-demo-password.mjs |   if (freeze.frozen) return `App Review | if (false) return `App Review
// @mutate scripts/rotate-review-demo-password.mjs |   if (!stored.ok) return { code: 1, | if (false) return { code: 1,
// @mutate scripts/rotate-review-demo-password.mjs |   lines.push(`GitHub secret ${SECRET_NAME} set`); |   lines.push(`GitHub secret ${SECRET_NAME} set ${password}`);
// @mutate scripts/rotate-review-demo-password.mjs |   if (!apply) { |   if (false) {
// @mutate fastlane/Fastfile | stage_review_demo_password!(staged_metadata_dir)\n\n      staged_screenshots_dir | \n\n      staged_screenshots_dir

const ROOT = join(__dirname, "..", "..");
const URL_ = "https://example.supabase.co";
const ID = "11111111-2222-4333-8444-555555555555";
const PASSWORD = "Zq9-test-only-password-x";

type Call = { url: string; method: string; body?: string };

function harness(opts: { putOk?: boolean; secretOk?: boolean } = {}) {
  const calls: Call[] = [];
  const order: string[] = [];
  const fetchImpl = async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body });
    if (method === "GET") {
      order.push("list");
      return { ok: true, status: 200, json: async () => ({ users: [{ id: "x", email: "someone@else.test" }, { id: ID, email: REVIEWER_EMAIL }] }) };
    }
    order.push("put");
    return { ok: opts.putOk ?? true, status: opts.putOk === false ? 500 : 200, json: async () => ({}) };
  };
  const setSecret = (p: string) => {
    order.push(`secret:${p === PASSWORD}`);
    return opts.secretOk === false ? { ok: false, why: "exit 1" } : { ok: true };
  };
  const writeBackup = () => {
    order.push("backup");
    return "/tmp/backup.txt";
  };
  return { calls, order, fetchImpl, setSecret, writeBackup };
}

describe("rotate-review-demo-password (Q1790)", () => {
  it("refuses --apply while App Review is running, and touches nothing", async () => {
    const h = harness();
    const r = await rotate({ apply: true, freeze: { frozen: true, version: "1.0.4", build: 7119 }, fetchImpl: h.fetchImpl, url: URL_, key: "k", setSecret: h.setSecret, writeBackup: h.writeBackup, gen: () => PASSWORD });
    expect(r.code).toBe(1);
    expect(r.lines.join("\n")).toMatch(/still running/);
    expect(h.order).toEqual([]);
  });

  it("refuses --apply when the freeze file is unreadable", () => {
    expect(refusal({ apply: true, freeze: null })).toMatch(/unreadable/);
    expect(refusal({ apply: false, freeze: null })).toBeNull();
  });

  it("a dry run finds the account and changes nothing", async () => {
    const h = harness();
    const r = await rotate({ apply: false, freeze: { frozen: true }, fetchImpl: h.fetchImpl, url: URL_, key: "k", setSecret: h.setSecret, writeBackup: h.writeBackup, gen: () => PASSWORD });
    expect(r.code).toBe(0);
    expect(r.lines.join("\n")).toContain(ID);
    expect(h.order).toEqual(["list"]);
  });

  it("after the review: stores the secret and backup BEFORE changing the account, and never prints the password", async () => {
    const h = harness();
    const r = await rotate({ apply: true, freeze: { frozen: false }, fetchImpl: h.fetchImpl, url: URL_, key: "k", setSecret: h.setSecret, writeBackup: h.writeBackup, gen: () => PASSWORD });
    expect(r.code).toBe(0);
    expect(h.order).toEqual(["list", "secret:true", "backup", "put"]);
    const put = h.calls.find((c) => c.method === "PUT");
    expect(put?.url).toBe(`${URL_}/auth/v1/admin/users/${ID}`);
    expect(JSON.parse(put?.body ?? "{}")).toEqual({ password: PASSWORD });
    expect(r.lines.join("\n")).not.toContain(PASSWORD);
  });

  it("a failed secret write leaves the account alone", async () => {
    const h = harness({ secretOk: false });
    const r = await rotate({ apply: true, freeze: { frozen: false }, fetchImpl: h.fetchImpl, url: URL_, key: "k", setSecret: h.setSecret, writeBackup: h.writeBackup, gen: () => PASSWORD });
    expect(r.code).toBe(1);
    expect(h.order).not.toContain("put");
  });

  it("a failed account update exits one and says the old password still works", async () => {
    const h = harness({ putOk: false });
    const r = await rotate({ apply: true, freeze: { frozen: false }, fetchImpl: h.fetchImpl, url: URL_, key: "k", setSecret: h.setSecret, writeBackup: h.writeBackup, gen: () => PASSWORD });
    expect(r.code).toBe(1);
    expect(r.lines.join("\n")).toMatch(/OLD password still works/);
  });

  it("both upload lanes stage the secret into the temporary metadata copy", () => {
    const fastfile = readFileSync(join(ROOT, "fastlane", "Fastfile"), "utf8");
    const calls = fastfile.match(/^\s*stage_review_demo_password!\(staged_metadata_dir\)$/gm) ?? [];
    expect(calls.length).toBe(2);
    const wf = readFileSync(join(ROOT, ".github", "workflows", "ios-metadata.yml"), "utf8");
    expect(wf).toMatch(/ASC_REVIEW_DEMO_PASSWORD: \$\{\{ secrets\.ASC_REVIEW_DEMO_PASSWORD \}\}/);
  });
});
