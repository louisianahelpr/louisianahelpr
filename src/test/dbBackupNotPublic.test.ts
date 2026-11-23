/*
 * GUARD (OPS-6, backend-ops audit 2026-11-23): the nightly prod DB backup is
 * not left as a long-lived artifact of this PUBLIC repo.
 *
 * Repo visibility measured 2026-11-23: PUBLIC, so any signed-in GitHub user can
 * download its Actions artifacts. The archive is gpg --symmetric (passphrase
 * only), and artifact db-backup-2026-11-22 (388,674,808 bytes, run
 * 45070133490) was set to expire 2026-12-22: ~30 public copies at steady state.
 *
 * Pinned here:
 *   1. With BACKUP_PRIVATE_REPO_TOKEN set, the archive goes to a release of
 *      the private helpr-workspace repo (refusing a repo that is not private),
 *      and the public upload-artifact step is skipped.
 *   2. Without it, the public artifact is kept at most 14 days (was 90, capped
 *      by the repo setting at 30).
 *   3. The restore drill reads the private store on the same rule, so moving
 *      the backups never silently breaks the weekly restore proof.
 */
// @mutate .github/workflows/db-backup.yml |           retention-days: 14 |           retention-days: 90
// @mutate .github/workflows/db-backup.yml |         if: ${{ steps.private.outputs.stored != 'true' }} |         if: ${{ always() }}
// @mutate .github/workflows/db-backup.yml |           GH_TOKEN: ${{ secrets.BACKUP_PRIVATE_REPO_TOKEN }} |           GH_TOKEN: ${{ secrets.NOT_A_SECRET }}
// @mutate .github/workflows/db-backup.yml | --jq .visibility \| grep -qx private | --jq .visibility \| grep -q .
// @mutate .github/workflows/db-restore-drill.yml |           PRIVATE_TOKEN: ${{ secrets.BACKUP_PRIVATE_REPO_TOKEN }} |           PRIVATE_TOKEN: ""

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";

const ROOT = resolve(__dirname, "../..");
type Step = { name?: string; id?: string; uses?: string; if?: string; run?: string; env?: Record<string, string>; with?: Record<string, unknown> };
const steps = (file: string, job: string): Step[] =>
  (parse(readFileSync(resolve(ROOT, file), "utf8")) as { jobs: Record<string, { steps: Step[] }> }).jobs[job].steps;

const backup = steps(".github/workflows/db-backup.yml", "backup");
const drill = steps(".github/workflows/db-restore-drill.yml", "drill");

describe("OPS-6: the prod DB backup does not sit in the public repo", () => {
  const store = backup.find((s) => s.id === "private");
  const uploads = backup.filter((s) => (s.uses ?? "").startsWith("actions/upload-artifact"));

  it("inventory floor: the backup job has its steps and exactly one artifact upload", () => {
    expect(backup.length).toBeGreaterThan(8);
    expect(uploads).toHaveLength(1);
  });

  it("stores the archive in the private repo when its token exists, refusing a non-private repo", () => {
    expect(store, "the private-store step (id: private)").toBeDefined();
    expect(store!.env?.GH_TOKEN).toBe("${{ secrets.BACKUP_PRIVATE_REPO_TOKEN }}");
    expect(store!.env?.PRIVATE_REPO).toBe("louisianahelpr/helpr-workspace");
    expect(store!.run).toMatch(/gh api "repos\/\$PRIVATE_REPO" --jq \.visibility \| grep -qx private \\/);
    expect(store!.run).toMatch(/gh release upload "\$RELEASE_TAG" "\$F"/);
    expect(store!.run).toMatch(/echo "stored=true" >> "\$GITHUB_OUTPUT"/);
    // Store step runs before the public upload.
    expect(backup.indexOf(store!)).toBeLessThan(backup.indexOf(uploads[0]));
  });

  it("skips the public artifact once the private copy is stored, and keeps any public one at most 14 days", () => {
    const up = uploads[0];
    expect(up.if).toBe("${{ steps.private.outputs.stored != 'true' }}");
    expect(Number(up.with?.["retention-days"])).toBeLessThanOrEqual(14);
    expect(Number(up.with?.["retention-days"])).toBeGreaterThan(7); // the drill needs a fresh one; 14 matches the pre-30-day history
  });

  it("the restore drill reads the private store on the same rule", () => {
    const dl = drill.find((s) => /Download the newest successful backup/.test(s.name ?? ""));
    expect(dl).toBeDefined();
    expect(dl!.env?.PRIVATE_TOKEN).toBe("${{ secrets.BACKUP_PRIVATE_REPO_TOKEN }}");
    expect(dl!.env?.PRIVATE_REPO).toBe(store!.env?.PRIVATE_REPO);
    expect(dl!.run).toMatch(/gh release download db-backups -R "\$PRIVATE_REPO"/);
    expect(store!.env?.RELEASE_TAG).toBe("db-backups");
  });
});
