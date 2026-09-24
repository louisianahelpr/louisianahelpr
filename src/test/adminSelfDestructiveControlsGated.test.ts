/**
 * DH-005: an admin must never be offered a destructive action on their OWN
 * account that the server will refuse only after the confirm (and, for Delete,
 * after a Face ID prompt). Each control below is disabled when the row is the
 * caller. The server refusals (admin-delete-user, removeAdmin) stay as
 * defence in depth.
 *
 * @mutate src/components/admin/userDetail/ActionsTab.tsx |             title={isSelf ? "You can't delete your own account from here — ask another admin." : undefined}\n            onClick={() => setDeleteProfile(viewProfile)} |             onClick={() => setDeleteProfile(viewProfile)}
 * @mutate src/components/admin/AdminSettings.tsx |                   disabled={removing === admin.role_id \|\| admin.user_id === selfId} |                   disabled={removing === admin.role_id}
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

// [file, the opener call, the self predicate that must sit in the same <Button>]
const CONTROLS: [string, string, RegExp][] = [
  ["src/components/admin/userDetail/ActionsTab.tsx", "setDeleteProfile(viewProfile)", /disabled=\{isSelf\}/],
  ["src/components/admin/userDetail/ActionsTab.tsx", "setBanProfile(viewProfile)", /disabled=\{isSelf\}/],
  ["src/components/admin/AdminSettings.tsx", "setConfirmRemove(admin)", /admin\.user_id === selfId/],
];

describe("admin destructive controls are disabled on the admin's own row (DH-005)", () => {
  it("inventory", () => {
    expect(CONTROLS.length).toBeGreaterThanOrEqual(3);
  });

  it.each(CONTROLS)("%s: %s is self-gated", (file, opener, gate) => {
    const src = read(file);
    const at = src.indexOf(opener);
    expect(at, opener).toBeGreaterThan(-1);
    const open = src.lastIndexOf("<Button", at);
    expect(src.slice(open, at)).toMatch(gate);
  });
});
