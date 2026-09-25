/**
 * EVERY FORM IN THE INVENTORY HAS ITS MESSY-INPUT COVERAGE DECIDED IN THE
 * COMMIT THAT ADDS IT (nightly-red #1754, prod-audit).
 *
 * The prod-audit nightly's last test is "coverage: every inventory file was
 * swept, explored, or has a stated gap". Runs 36003051878 and 36069316906 both
 * went red on it with one file:
 *
 *     no sweep, no explore credit and no stated gap:
 *     src/components/admin/DeleteUserDialog.tsx
 *
 * Q234 gave that dialog a typed DELETE confirm, the regenerated
 * docs/audit/form-inventory.md picked the new input up, and nothing but a
 * 1.6-hour prod run could say the file was unaccounted for. It never could be
 * credited: its only opener, "Delete Account", is refused by NEVER_PRESS.
 *
 * Coverage has three sources: FORMS (a URL sweep), GAPS (a stated reason) and
 * the explore presser's run-time credits. The first two are source; the third
 * is declared as EXPLORE_CREDITED. This holds `inventory − FORMS − GAPS`
 * EXACTLY equal to EXPLORE_CREDITED, so a new inventory file is red here, at
 * commit time, until someone decides which of the three it is; the nightly
 * then checks explore really credited every EXPLORE_CREDITED file.
 *
 * @mutate e2e/prod-audit/messyInputForms.ts |   "src/components/admin/DeleteUserDialog.tsx": "reachable | // "src/components/admin/DeleteUserDialog.tsx": "reachable
 * @mutate e2e/prod-audit/messyInputForms.ts |   "src/components/profile/SecurityTab.tsx", |
 * @mutate e2e/prod-audit/messyInputForms.ts |   "src/components/admin/AdminMarketing.tsx", |   "src/components/admin/AdminMarketing.tsx", "src/components/admin/DeleteUserDialog.tsx",
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const inventory = [...read("docs/audit/form-inventory.md").matchAll(/^\| `(src\/[^`]+)`/gm)].map((m) => m[1]);
const forms = blankComments(read("e2e/prod-audit/messyInputForms.ts"));

/** The source between `export const <name>` and the `];` / `};` that closes it. */
function block(name: string, close: string): string {
  const start = forms.indexOf(`export const ${name}`);
  expect(start, `export const ${name} not found in messyInputForms.ts — this guard has rotted`).toBeGreaterThan(-1);
  const end = forms.indexOf(`\n${close}`, start);
  expect(end).toBeGreaterThan(start);
  return forms.slice(start, end);
}

const covers = new Set(
  [...block("FORMS", "];").matchAll(/covers:\s*\[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/"(src\/[^"]+)"/g)].map((x) => x[1])),
);
const gaps = new Set([...block("GAPS", "};").matchAll(/^\s*"(src\/[^"]+)":/gm)].map((m) => m[1]));
const explore = [...block("EXPLORE_CREDITED", "];").matchAll(/"(src\/[^"]+)"/g)].map((m) => m[1]);

describe("messy-input coverage is decided for every inventory file", () => {
  it("reads real lists", () => {
    expect(inventory.length).toBeGreaterThan(100);
    expect(covers.size).toBeGreaterThan(50);
    expect(gaps.size).toBeGreaterThan(40);
    expect(explore.length).toBeGreaterThan(5);
  });

  it("inventory − FORMS − GAPS is exactly EXPLORE_CREDITED", () => {
    const undecided = inventory.filter((f) => !covers.has(f) && !gaps.has(f));
    expect(
      undecided.filter((f) => !explore.includes(f)),
      "inventory files with no FORMS sweep, no GAP and no EXPLORE_CREDITED entry: decide which one each is",
    ).toEqual([]);
    expect(
      explore.filter((f) => !undecided.includes(f)),
      "EXPLORE_CREDITED entries that are not in the inventory, or are already swept or excused: delete them",
    ).toEqual([]);
  });

  it("DeleteUserDialog's gap is true: NEVER_PRESS refuses its only opener", () => {
    const harness = blankComments(read("e2e/prod-audit/harness.ts"));
    const lit = /export const NEVER_PRESS = \/(.+)\/([a-z]*);/.exec(harness);
    expect(lit, "NEVER_PRESS not found in harness.ts").not.toBeNull();
    const neverPress = new RegExp(lit![1], lit![2]);
    const actions = read("src/components/admin/userDetail/ActionsTab.tsx");
    expect(actions).toMatch(/onClick=\{\(\) => setDeleteProfile\(viewProfile\)\}[\s\S]{0,80}Delete Account/);
    expect(neverPress.test("Delete Account")).toBe(true);
    expect(gaps.has("src/components/admin/DeleteUserDialog.tsx")).toBe(true);
  });
});
