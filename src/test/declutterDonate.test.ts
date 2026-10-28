/**
 * GUARD (Q2428, owner 2026-10-27): donate what doesn't sell. A Helpr haul-away takes unsold items to an
 * admin-curated partner charity; the seller gets an in-app receipt (item, date, charity; never a value).
 * Behaviour is proven in src/test/pglite/declutterDonate.pglite.mjs (33 checks); this pins the rules it proves
 * on the newest definitions, and the client half (the prefill names the charity, the receipt states no value).
 *
 * @mutate supabase/migrations/20261027222743_declutter_donate.sql |          AND strpos(lower(COALESCE(NEW.description, '')), lower('Drop off at ' \|\| d.partner_name \|\| ',')) > 0\n |
 * @mutate supabase/migrations/20261027222743_declutter_donate.sql |   UPDATE public.declutter_donations d SET job_id = NULL, donated_at = NULL\n   WHERE d.item_id = ANY (v_ids) AND d.donated_at IS NOT NULL | PERFORM 1 FROM public.declutter_donations d WHERE d.item_id = ANY (v_ids) AND d.donated_at IS NOT NULL
 * @mutate supabase/migrations/20261027222743_declutter_donate.sql |     IF public.declutter_haul_job_hold(v_job) <> 'none' THEN |     IF false THEN
 * @mutate supabase/migrations/20261027222743_declutter_donate.sql | OR v_miles > (public.declutter_donation_rules() ->> 'near_miles')::integer | OR false
 * @mutate supabase/migrations/20261027222743_declutter_donate.sql |      WHERE (p_item_ids IS NULL OR d.item_id = ANY (p_item_ids))\n |      WHERE p_item_ids IS NULL OR d.item_id = ANY (p_item_ids)\n
 * @mutate supabase/migrations/20261027222743_declutter_donate.sql |   WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM NEW.status) |   WHEN (NEW.status = 'completed')
 * @mutate src/lib/declutter/haulAway.ts |       `Drop off at ${partner.name}, ${partner.address}.`,\n |
 * @mutate src/lib/declutter/donate.ts |   return mine.every((r) => r!.partner_name === first.partner_name && r!.partner_address === first.partner_address) |   return true
 * @mutate src/pages/post-job/useHaulAwayPrefill.ts |         if (picked) p = d.buildDonationPrefill(rows, picked) ?? p; |
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { newestFunction } from "./helpers/parityReaders";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { buildDonationPrefill } from "@/lib/declutter/haulAway";
import { oneDonationPartner, type MyDonation } from "@/lib/declutter/donate";
import type { HaulAwayRow } from "@/lib/declutter/haulAwayParam";

const FILE = "20261027222743";
const code = (name: string) => blankSqlComments(newestFunction(name).body).replace(/\s+/g, " ");
const read = (p: string) => blankComments(readFileSync(p, "utf8")).replace(/\s+/g, " ");
const SQL = readFileSync(`supabase/migrations/${FILE}_declutter_donate.sql`, "utf8").replace(/\s+/g, " ");

describe("Q2428 donate what doesn't sell: the server", () => {
  it("reads the newest definitions (floor)", () => {
    const names = ["declutter_donation_partners_near", "declutter_choose_donation", "declutter_my_donations",
      "declutter_donation_job_completed", "admin_declutter_save_donation_partner", "declutter_donation_partner_miles"];
    for (const n of names) expect(newestFunction(n).file, n).toContain(FILE);
    expect(names.length).toBeGreaterThan(5);
  });

  it("a receipt only when the completed job names the charity, once, and the job's write always lands", () => {
    const t = code("declutter_donation_job_completed");
    expect(t).toContain("AND strpos(lower(COALESCE(NEW.description, '')), lower('Drop off at ' || d.partner_name || ',')) > 0");
    expect(t).toContain("SET job_id = NEW.id, donated_at = now() WHERE item_id = r.item_id AND donated_at IS NULL");
    expect(t).toContain("EXCEPTION WHEN OTHERS THEN PERFORM public.log_cron_defect(");
    expect(SQL).toContain("WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM NEW.status)");
  });

  it("the choice: the seller's unsold items, a near active partner, locked once a job holds them", () => {
    const c = code("declutter_choose_donation");
    expect(c).toContain("IF public.is_caller_banned() THEN");
    expect(c).toContain("v_ids := public.declutter_donation_own_items(v_uid, p_item_ids);");
    expect(c).toContain("i.status NOT IN ('live', 'ended')");
    // A receipt its job no longer backs is cleared before the already-donated check (lh-authz-rls review #1).
    expect(c.indexOf("UPDATE public.declutter_donations d SET job_id = NULL, donated_at = NULL")).toBeGreaterThan(-1);
    expect(c.indexOf("UPDATE public.declutter_donations d SET job_id = NULL, donated_at = NULL")).toBeLessThan(c.indexOf("RAISE EXCEPTION 'donation_already_done'"));
    expect(c).toContain("IF public.declutter_haul_job_hold(v_job) <> 'none' THEN RAISE EXCEPTION 'donation_locked'");
    expect(c).toContain("OR v_miles > (public.declutter_donation_rules() ->> 'near_miles')::integer THEN RAISE EXCEPTION 'donation_partner_unavailable'");
  });

  it("a receipt shows only while the job is still the item's haul-away and was not refunded in full", () => {
    const m = code("declutter_my_donations");
    expect(m).toContain("EXISTS (SELECT 1 FROM public.declutter_haul_aways h WHERE h.item_id = d.item_id AND h.job_id = d.job_id)");
    expect(m).toContain("j.payment_status IS DISTINCT FROM 'refunded'");
    expect(m).toContain("WHERE (p_item_ids IS NULL OR d.item_id = ANY (p_item_ids)) AND (d.donated_at IS NULL OR r.ok)");
  });

  it("no value anywhere: the receipt table and reads carry no amount", () => {
    expect(SQL).not.toMatch(/value_cents|fair_market|estimated_value/);
    expect(read("src/components/declutter/DeclutterDonate.tsx")).toContain("It doesn't state a value.");
  });

  it("grants: members never read the tables or run the helpers; the partners table is admin-read only", () => {
    expect(SQL).toContain("REVOKE ALL ON TABLE public.declutter_donations FROM PUBLIC, anon, authenticated;");
    expect(SQL).toContain("USING (COALESCE(public.has_role((SELECT auth.uid()), 'admin'::public.app_role), false));");
    expect(SQL).toContain("REVOKE ALL ON FUNCTION public.declutter_donation_job_completed() FROM PUBLIC, anon, authenticated;");
    expect(SQL).toContain("REVOKE ALL ON FUNCTION public.declutter_donation_partner_miles(uuid, uuid[]) FROM PUBLIC, anon, authenticated;");
  });
});

describe("Q2428 donate what doesn't sell: the client", () => {
  const row = (id: string, title: string): HaulAwayRow =>
    ({ item_id: id, title, delivery_size: "large", state: "eligible", job_id: null, pickup_group: "g", photo_paths: [], status: "live" }) as unknown as HaulAwayRow;

  it("the donation job names the charity first (the receipt needs it), never the dump", () => {
    const p = buildDonationPrefill([row("a", "Oak chair"), row("b", "Lamp")], { name: "Goodwill Mid-City", address: "100 Charity Way" });
    expect(p?.title).toBe("Donate 2 items");
    expect(p?.description.startsWith("Drop off at Goodwill Mid-City, 100 Charity Way.")).toBe(true);
    expect(p?.description).not.toMatch(/dump/i);
  });

  it("the prefill uses the charity only when every item is set to the same one (no receipt yet)", () => {
    const d = (item: string, name: string, receipt = false): MyDonation =>
      ({ item_id: item, item_title: item, partner_name: name, partner_address: "1 St", chosen_at: "", donated_at: null, receipt });
    expect(oneDonationPartner([d("a", "G"), d("b", "G")], ["a", "b"])).toEqual({ name: "G", address: "1 St" });
    expect(oneDonationPartner([d("a", "G"), d("b", "H")], ["a", "b"])).toBeNull();
    expect(oneDonationPartner([d("a", "G")], ["a", "b"])).toBeNull();
    expect(oneDonationPartner([d("a", "G", true)], ["a"])).toBeNull();
  });

  it("Post a Job applies the donation prefill on ?donate=1", () => {
    const s = read("src/pages/post-job/useHaulAwayPrefill.ts");
    expect(s).toContain('const donate = searchParams.get("donate") === "1";');
    expect(s).toContain("if (picked) p = d.buildDonationPrefill(rows, picked) ?? p;");
  });
});
