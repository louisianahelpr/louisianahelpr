/**
 * Q2338 (owner ruling 2026-10-22, Declutter terms #12; lead 2026-11-01): Declutter strikes stay tied to the verified ID.
 * At deletion the member's ACTIVE strikes are kept under the one-way identity hash only (no user id or contact details);
 * stripe-idv-webhook restores them when the same identity verifies a new account; the Terms and Privacy say so.
 * Backend proof: src/test/pglite/declutterStrikesSurviveDeletion.pglite.mjs (3x; red without the migration and on its
 * planted defects).
 *
 * @mutate supabase/functions/stripe-idv-webhook/index.ts | supabase.rpc("declutter_restore_retained_strikes", { | supabase.rpc("declutter_restore_retained_strikes_off", {
 * @mutate supabase/functions/stripe-idv-webhook/index.ts |             throw new Error(`declutter_restore_retained_strikes failed: ${strikeErr.message}`); |             console.log(strikeErr.message);
 * @mutate src/pages/info/legal/TermsSection.tsx | a record of those strikes is kept after deletion to stop repeat abuse | your strikes are erased
 * @mutate src/pages/info/legal/PrivacySection.tsx | we keep a record of those strikes | we erase those strikes
 * @mutate supabase/migrations/20261102032514_declutter_strikes_survive_deletion.sql | WHERE s.user_id = OLD.id AND s.removed_at IS NULL AND s.expires_at > now(); | WHERE s.user_id = OLD.id;
 * @mutate supabase/migrations/20261102032514_declutter_strikes_survive_deletion.sql |   BEFORE DELETE ON auth.users\n  FOR EACH ROW EXECUTE FUNCTION public.declutter_retain_strikes_on_delete(); |   AFTER DELETE ON auth.users\n  FOR EACH ROW EXECUTE FUNCTION public.declutter_retain_strikes_on_delete();
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const read = (p: string) => blankComments(readFileSync(join(process.cwd(), p), "utf8"));
const defs = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const flat = (s: string) => s.replace(/\s+/g, " ");
const MIG = flat(blankSqlComments(readFileSync(join(process.cwd(), "supabase/migrations/20261102032514_declutter_strikes_survive_deletion.sql"), "utf8")));

describe("Declutter strikes survive account deletion, keyed only by the identity hash", () => {
  it("deletion keeps only active strikes, before the CASCADE, and never refuses the delete", () => {
    expect(defs.size).toBeGreaterThan(500);
    const keep = flat(blankSqlComments(defs.get("declutter_retain_strikes_on_delete")?.stmt ?? ""));
    expect(keep.length).toBeGreaterThan(400);
    expect(keep).toContain("WHERE s.user_id = OLD.id AND s.removed_at IS NULL AND s.expires_at > now();");
    expect(keep).toContain("EXCEPTION WHEN OTHERS THEN");
    expect(MIG).toContain("BEFORE DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION public.declutter_retain_strikes_on_delete();");
  });

  it("the kept table holds no user id or contact columns and no client privilege", () => {
    const table = MIG.slice(MIG.indexOf("CREATE TABLE IF NOT EXISTS public.declutter_retained_strikes"), MIG.indexOf("CREATE INDEX IF NOT EXISTS declutter_retained_strikes_identity_idx"));
    expect(table.length).toBeGreaterThan(200);
    expect(table).not.toMatch(/user_id|email|phone|name|address|item_id|appeal/);
    expect(MIG).toContain("REVOKE ALL ON TABLE public.declutter_retained_strikes FROM PUBLIC, anon, authenticated;");
    expect(MIG).toContain("REVOKE ALL ON FUNCTION public.declutter_restore_retained_strikes(uuid, text) FROM PUBLIC, anon, authenticated;");
  });

  it("a new verification restores them, and an unanswered call never approves", () => {
    const hook = read("supabase/functions/stripe-idv-webhook/index.ts");
    const ban = hook.indexOf('supabase.rpc("enforce_retained_ban", {');
    const restore = hook.indexOf('supabase.rpc("declutter_restore_retained_strikes", {');
    expect(ban).toBeGreaterThan(0);
    expect(restore).toBeGreaterThan(ban);
    expect(hook).toContain("throw new Error(`declutter_restore_retained_strikes failed: ${strikeErr.message}`);");
  });

  it("the Terms and the Privacy Policy say a strike record tied to a verified ID is kept after deletion", () => {
    expect(read("src/pages/info/legal/TermsSection.tsx")).toContain("a record of those strikes is kept after deletion to stop repeat abuse");
    expect(read("src/pages/info/legal/PrivacySection.tsx")).toContain("we keep a record of those strikes");
  });
});
