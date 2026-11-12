/**
 * Shops digital downloads, slice 1 (owner 11-08): the files are private and only shop-digital signs links into them.
 * Behaviour on a real database is src/test/pglite/shopsDigitalDownloads.pglite.mjs (3x; NEW_MIGRATION=skip is RED,
 * and a planted "refunded still downloads" is RED). This guard pins the edge function's side: who the caller is comes
 * from the token, the download check is the database's, a link lives 10 minutes, and a file is checked from its own
 * bytes before it is ever marked usable; and the migration's side: the bucket is private and no storage policy names it.
 *
 * @mutate supabase/functions/shop-digital/index.ts | const DOWNLOAD_LINK_SECONDS = 600; | const DOWNLOAD_LINK_SECONDS = 604800;
 * @mutate supabase/functions/shop-digital/index.ts | { p_file_id: fileId, p_user: userId } | { p_file_id: fileId, p_user: String(body.user_id) }
 * @mutate supabase/functions/shop-digital/index.ts |   else refusal = await refusalFor(admin, row.storage_path, row.ext as DigitalExt, size); |   else refusal = null;
 * @mutate supabase/functions/shop-digital/index.ts |   const off = await requireFeature(admin, "shops", user, corsHeaders);\n  if (off) return off;\n |
 * @mutate supabase/migrations/20261108182917_shops_digital_downloads.sql | VALUES ('shop-digital', 'shop-digital', false, 104857600, | VALUES ('shop-digital', 'shop-digital', true, 104857600,
 * @mutate supabase/migrations/20261109224952_notices_card_fee_and_our_team.sql |   IF o.is_digital AND NOT COALESCE(p_allow_problem, false) THEN |   IF false THEN
 * @mutate supabase/migrations/20261112093000_shops_setup_fee_notice_exact.sql |   IF o.is_digital AND p_how = 'auto' AND o.captured_at + interval '72 hours' > now() THEN |   IF false THEN
 * @mutate supabase/migrations/20261112073633_shops_audit_highs.sql |          OR (o.is_digital AND o.captured_at + interval '72 hours' <= now())) |          OR (o.is_digital AND o.captured_at + interval '24 hours' <= now()))
 * @mutate supabase/migrations/20261108182917_shops_digital_downloads.sql |        AND o.status IN ('accepted', 'handed_over')\n       AND o.captured_at IS NOT NULL | AND o.status IN ('accepted', 'handed_over', 'refunded')\n       AND o.captured_at IS NOT NULL
 * Review 11-08 (money BLOCK): the snapshot trigger is restated from its NEWEST body; a paid-not-captured order counts
 * as bought; the card that pays is the address taxed; a hand refund or a chargeback ends the download.
 * @mutate supabase/migrations/20261108182917_shops_digital_downloads.sql |       (SELECT st.tax_kind FROM public.shop_custom_requests cr | (SELECT NULL::text FROM public.shop_custom_requests cr
 * @mutate supabase/migrations/20261108182917_shops_digital_downloads.sql |   NEW.at_buyer := COALESCE(NEW.tax_kind = 'fabric_cleaning' AND | NEW.at_buyer := COALESCE(false AND
 * @mutate supabase/migrations/20261108182917_shops_digital_downloads.sql |        AND NOT EXISTS (SELECT 1 FROM public.shop_hand_refunds hr WHERE hr.order_id = o.id AND hr.failed_at IS NULL)); |        );
 * @mutate supabase/migrations/20261108182917_shops_digital_downloads.sql |        AND o.digital_access_revoked_at IS NULL\n |
 * @mutate supabase/migrations/20261108185110_shops_digital_checkout.sql |                 AND o.status IN ('accepted', 'handed_over')) THEN |                 AND o.captured_at IS NOT NULL AND o.status IN ('accepted', 'handed_over')) THEN
 * @mutate supabase/migrations/20261111025213_shops_gift_hold_steps.sql |   IF p_billing_matches IS NOT TRUE THEN |   IF false THEN
 * @mutate supabase/migrations/20261108185110_shops_digital_checkout.sql |   UPDATE public.shop_orders SET digital_access_revoked_at = COALESCE(digital_access_revoked_at, now()) WHERE id = o.id; |   NULL;
 *
 * Slice 2 (checkout) behaviour: src/test/pglite/shopsDigitalCheckout.pglite.mjs (3x; NEW_MIGRATION=skip RED; planted
 * "a member cancel refunds a download", "a download takes a day slot", "a refund keeps the download" and "nudge a
 * download buyer" each RED). This file pins the newest definitions so a later restatement cannot drop them.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const ROOT = resolve(__dirname, "../..");
const EDGE = blankComments(readFileSync(resolve(ROOT, "supabase/functions/shop-digital/index.ts"), "utf8"));
const SQL = blankSqlComments(readFileSync(resolve(ROOT, "supabase/migrations/20261108182917_shops_digital_downloads.sql"), "utf8"));

describe("Shops digital downloads: private files, short links, checked bytes", () => {
  it("every action runs behind the Shops switch, after the token is read", () => {
    const auth = EDGE.indexOf("auth.getUser(");
    const feature = EDGE.indexOf('requireFeature(admin, "shops", user, corsHeaders)');
    const dispatch = EDGE.indexOf('body.action === "upload_url"');
    expect(auth).toBeGreaterThan(0);
    expect(feature).toBeGreaterThan(auth);
    expect(dispatch).toBeGreaterThan(feature);
  });

  it("the download check is the database's, with the caller from the token, and a link lives 10 minutes", () => {
    expect(EDGE).toMatch(/const DOWNLOAD_LINK_SECONDS = 600;/);
    expect(EDGE).toContain('admin.rpc("shop_digital_download_path", { p_file_id: fileId, p_user: userId })');
    expect(EDGE).toMatch(/return await download\(body, user\.id, admin\)/);
    expect(EDGE).not.toMatch(/body\.(user_id|owner_id|buyer_id)/);
    // A raw storage URL is never handed out: only a signed link.
    expect(EDGE).not.toMatch(/getPublicUrl/);
  });

  it("a file is marked checked only after its own bytes pass", () => {
    const check = EDGE.indexOf("refusal = await refusalFor(admin, row.storage_path, row.ext as DigitalExt, size)");
    const mark = EDGE.indexOf('admin.rpc("shop_digital_file_checked"');
    expect(check).toBeGreaterThan(0);
    expect(mark).toBeGreaterThan(check);
    expect(EDGE).toMatch(/bytesMatchExt\(ext, head\.subarray\(0, SNIFF_BYTES\)\)/);
    expect(EDGE).toMatch(/zipProgramEntry\(cd, dir\.entries\)/);
  });

  it("the bucket is private and no storage policy in the migration names it", () => {
    expect(SQL).toMatch(/VALUES \('shop-digital', 'shop-digital', false, 104857600,/);
    expect(SQL).toMatch(/ON CONFLICT \(id\) DO UPDATE SET\s+public = false/);
    expect(SQL).not.toMatch(/CREATE POLICY[^;]*ON storage\.objects/i);
    // The storage path column is never granted to members.
    const grant = /GRANT SELECT \(([^)]*)\)\s+ON TABLE public\.shop_item_files TO authenticated/.exec(SQL);
    expect(grant?.[1].split(",").map((c) => c.trim()).length).toBeGreaterThan(5);
    expect(grant?.[1]).not.toMatch(/storage_path/);
  });
});

describe("Shops digital downloads: buying one (the newest definitions)", () => {
  const DEFS = effectiveDefs(resolve(ROOT, "supabase/migrations"));
  const flat = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");

  it("reads the real definitions (floor)", () => {
    expect([...DEFS.keys()].filter((n) => /digital/.test(n)).length).toBeGreaterThan(4);
  });

  it("no member cancel, shop cancel or no-show refunds a download; the admin's refund still can", () => {
    expect(flat("shop_lock_open_charged_order")).toContain("IF o.is_digital AND NOT COALESCE(p_allow_problem, false) THEN RAISE EXCEPTION 'digital_not_cancellable'");
  });

  it("a download is final 72 hours after its charge, through the one transition, and never by a pickup tap", () => {
    const done = flat("shop_complete_handover");
    expect(done).toContain("IF o.is_digital AND p_how = 'auto' AND o.captured_at + interval '72 hours' > now() THEN RAISE EXCEPTION 'too_soon'");
    expect(done).toContain("IF o.is_digital AND p_how = 'buyer' THEN RAISE EXCEPTION 'digital_no_pickup'");
    const sweep = flat("shop_handover_sweep");
    expect(sweep).toContain("OR (o.is_digital AND o.captured_at + interval '72 hours' <= now()))");
    expect(sweep).toContain("AND NOT o.is_digital");
  });

  it("the download is open from the charge until a refund, a hand refund in Stripe or a chargeback", () => {
    const ok = flat("shop_digital_access_ok");
    expect(ok).toContain("AND o.status IN ('accepted', 'handed_over') AND o.captured_at IS NOT NULL");
    expect(ok).toContain("AND o.digital_access_revoked_at IS NULL");
    expect(ok).toContain("AND NOT EXISTS (SELECT 1 FROM public.shop_hand_refunds hr WHERE hr.order_id = o.id AND hr.failed_at IS NULL)");
    expect(ok).not.toMatch(/'refunded'/);
    expect(flat("shop_digital_download_path")).toContain("public.shop_digital_access_ok(l.order_id, p_user)");
    expect(flat("shops_my_digital_files")).toContain("public.shop_digital_access_ok(o.id, (SELECT auth.uid()))");
    const dispute = flat("shop_digital_dispute_event");
    expect(dispute).toContain("SET digital_access_revoked_at = COALESCE(digital_access_revoked_at, now())");
  });

  it("review 11-08: the snapshot keeps the custom-request fallback and the at-buyer flag; bought means paid", () => {
    const snap = flat("shop_order_line_snapshot_tax_kind");
    expect(snap).toContain("CASE WHEN NEW.kind IN ('service', 'digital') THEN COALESCE(");
    expect(snap).toContain("(SELECT st.tax_kind FROM public.shop_custom_requests cr JOIN public.shop_item_subtypes st ON st.slug = cr.subtype");
    expect(snap).toContain("NEW.at_buyer := COALESCE(NEW.tax_kind = 'fabric_cleaning' AND");
    const req = flat("shops_request_digital_order");
    expect(req).toContain("AND l.item_id = v_item.id AND o.status IN ('accepted', 'handed_over')) THEN RAISE EXCEPTION 'already_bought'");
    expect(flat("shop_digital_mark_paid")).toContain("IF p_billing_matches IS NOT TRUE THEN");
  });
});
