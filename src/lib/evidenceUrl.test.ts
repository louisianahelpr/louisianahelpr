/**
 * Dispute evidence is rendered as <a href> + <img src> in the admin console and
 * in both parties' timeline dialog. A party could store any string there
 * (open_dispute_as's re-file branch, the opener's direct UPDATE, and the legacy
 * jobs.dispute_evidence_urls array): a foreign image leaks the viewer's IP, a
 * link becomes a phishing tile in the admin queue (lh-authz-rls review of the
 * dispute-races rebase, MEDIUM). The server now validates new evidence; the
 * client renders only this project's signed proof-photos URLs and says how many
 * it withheld.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { isTrustedEvidenceUrl, partitionEvidenceUrls } from "./evidenceUrl";

const BASE = "https://proj.supabase.co";
const good = `${BASE}/storage/v1/object/sign/proof-photos/uid-1/disputes/job-1/a.jpg?token=t`;

describe("isTrustedEvidenceUrl", () => {
  it("accepts this project's signed proof-photos object URL", () => {
    expect(isTrustedEvidenceUrl(good, BASE)).toBe(true);
  });

  it.each([
    ["another host carrying the same path", `https://attacker.example/storage/v1/object/sign/proof-photos/uid-1/disputes/job-1/a.jpg`],
    ["a javascript: URL", "javascript:alert(document.domain)"],
    ["the public (not signed) object route", `${BASE}/storage/v1/object/public/proof-photos/uid-1/disputes/job-1/a.jpg`],
    ["another bucket", `${BASE}/storage/v1/object/sign/avatars/uid-1/a.jpg`],
    ["http", good.replace("https://", "http://")],
    ["garbage", "not a url"],
  ])("refuses %s", (_label, url) => {
    expect(isTrustedEvidenceUrl(url, BASE)).toBe(false);
  });

  it("partitions a list and counts what it withheld", () => {
    expect(partitionEvidenceUrls([good, "https://attacker.example/x.png", good], BASE)).toEqual({ trusted: [good, good], withheld: 1 });
  });

  it("both evidence renderers go through it", () => {
    for (const f of ["src/components/DisputeTimelineDialog.tsx", "src/components/admin/adminDisputes/DisputeCard.tsx"]) {
      expect(readFileSync(f, "utf8")).toContain("partitionEvidenceUrls(");
    }
  });
});
