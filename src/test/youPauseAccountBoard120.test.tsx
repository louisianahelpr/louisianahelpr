/**
 * BOARD 120's gaps (owner 2026-10-25: "build the gaps"), behind 'account_pause':
 *  - "Pause my account" in You › Settings › Your account: the confirm says what happens; the
 *    pause-own-account edge function refuses while there is live work (the SAME findActiveWork as
 *    deletion) or an open job posted, then account_pause_apply takes the live listings down;
 *  - a paused member's profile reads "This member has paused their account" to everyone else;
 *  - the delete sheet's money line ("Coming to you … · held for your jobs …") and "Pause instead".
 * Server behaviour: src/test/pglite/accountPause.pglite.mjs (3x replay).
 *
 * @mutate src/components/profile/settings/DeleteSheetExtras.tsx |     comingCents > 0 ? `Coming to you: ${formatCents(comingCents)}` : null, |     null,
 * @mutate src/components/profile/settings/DeleteSheetExtras.tsx |   if (parts.length === 0) return null; |   if (parts.length < 0) return null;
 * @mutate supabase/functions/pause-own-account/index.ts |     if (active.active) return json({ error: PAUSE_REFUSED.active, reason: "active" }, 409); |     if (false) return json({ error: PAUSE_REFUSED.active, reason: "active" }, 409);
 * @mutate supabase/functions/pause-own-account/index.ts |     if ((open.count ?? 0) > 0) return json( |     if (false) return json(
 * @mutate src/pages/user/useUserProfileData.ts |         if (!paused.error && paused.data === true) return { profile: null as Profile \| null, paused: true }; |         if (false) return { profile: null as Profile \| null, paused: true };
 * @mutate src/components/profile/SettingsTab.tsx |         <PauseAccount>{(r) => <Row testId={r.testId} label={r.label} sub={r.sub} onClick={r.onClick} />}</PauseAccount> |         {null}
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { deleteMoneyLine } from "@/components/profile/settings/DeleteSheetExtras";
import { PAUSE_WHAT_HAPPENS } from "@/components/profile/settings/PauseAccount";

const read = (p: string) => blankComments(readFileSync(resolve(__dirname, "..", p), "utf8"));
const readRoot = (p: string) => blankComments(readFileSync(resolve(__dirname, "../..", p), "utf8"));

describe("board 120: the delete sheet's money line", () => {
  it("names what is coming and what is held, says the delete waits, and that nothing is lost", () => {
    expect(deleteMoneyLine(9655, 4000)).toBe("Coming to you: $96.55 · held for your jobs: $40.00. You can delete once these settle. Nothing is lost.");
    expect(deleteMoneyLine(0, 4000)).toBe("Held for your jobs: $40.00. You can delete once these settle. Nothing is lost.");
    expect(deleteMoneyLine(9655, 0)).toBe("Coming to you: $96.55. You can delete once these settle. Nothing is lost.");
    expect(deleteMoneyLine(0, 0)).toBeNull();
    for (const l of [deleteMoneyLine(9655, 4000)!]) expect(l).not.toMatch(/forfeit|lose your|fee/i);
  });

  it("step 1 carries the line and Pause instead", () => {
    const dlg = read("components/profile/DeleteAccountDialog.tsx");
    const at = dlg.indexOf("<WhatHappens />");
    expect(dlg.indexOf("<DeleteMoneyLine />")).toBeGreaterThan(at);
    expect(dlg.indexOf("<PauseInsteadLink onLeave={() => handleOpenChange(false)} />")).toBeGreaterThan(at);
    expect(read("components/profile/settings/DeleteSheetExtras.tsx")).toContain('navigate("/profile?tab=settings&pause=1")');
  });
});

describe("board 120: pause my account", () => {
  it("the confirm says what happens, one sentence each", () => {
    expect(PAUSE_WHAT_HAPPENS.length).toBeGreaterThan(2);
    expect(PAUSE_WHAT_HAPPENS.join(" ")).toMatch(/listings come down/);
    expect(PAUSE_WHAT_HAPPENS.join(" ")).toMatch(/Resume any time/);
  });

  it("the server refuses while there is live work or an open job, before anything changes", () => {
    const fn = readRoot("supabase/functions/pause-own-account/index.ts");
    const feature = fn.indexOf('requireFeature(admin, "account_pause", user, corsHeaders)');
    const active = fn.indexOf("await findActiveWork(admin, user.id)");
    const open = fn.indexOf('.eq("customer_id", user.id).eq("status", "open")');
    const apply = fn.indexOf('admin.rpc("account_pause_apply", { p_user_id: user.id })');
    expect(feature).toBeGreaterThan(0);
    expect(active).toBeGreaterThan(feature);
    expect(open).toBeGreaterThan(active);
    expect(apply).toBeGreaterThan(open);
    expect(fn).toContain('if (!active.ok) return json({ error: "Couldn\'t check your account just now. Try again." }, 500);');
  });

  it("Settings shows the row; a paused member's profile is hidden from others with its own words", () => {
    expect(read("components/profile/SettingsTab.tsx")).toContain("<PauseAccount>{(r) => <Row");
    const data = read("pages/user/useUserProfileData.ts");
    expect(data).toContain('supabase.rpc("account_is_paused", { p_user_id: pausedOwner })');
    expect(data).toMatch(/currentUserId && currentUserId !== pausedOwner && currentUserId !== userId/);
    expect(read("pages/user/UserProfile.tsx")).toContain('"This member has paused their account"');
  });
});
