/**
 * Shops audit 11-08 fixes (~/.lh-shots/handoffs-1108/shops-audit.md), the static half. Reads the NEWEST definition of
 * each function (any dollar tag, src/test/helpers/effectiveFunctionDefs.ts), comments blanked, so a later restatement
 * that drops a fix turns this red.
 *
 *   #1 "Half up front" stays closed while shops_order_custom_quote refuses it (deposit_not_ready): the setter refuses
 *      it and the screen never offers it (shopCustomOrdersPicker.test.tsx).
 *   #2 The shop's private pickup address goes to a buyer only on a pickup with no at-home line.
 *   #3 An order with a service, rental or at-home line is always in person, so the porch ready-photo rule (refund +
 *      strike no_ready_photo) never reaches it; the move is allowed only on an unpaid order.
 *   #6 Shops notices are filed under their own kinds (shops_orders / shops_messages / shops_updates) by
 *      declutter_notify's router, never a Jobs switch; each kind has a switch on the screen.
 *
 * Behaviour (red/green, 3x replay): src/test/pglite/shopsDepositHiddenPickupPrivate.pglite.mjs
 * (15 PASS; NEW_MIGRATION=skip -> 8 FAIL, measured 2026-11-08); src/test/pglite/shopsServicesInPerson.pglite.mjs
 * (10 PASS; NEW_MIGRATION=skip -> 6 FAIL); src/test/pglite/shopsNoticeKinds.pglite.mjs (18 PASS; skip -> 13 FAIL).
 *
 * @mutate supabase/migrations/20261108195900_shops_deposit_hidden_pickup_private.sql |   IF p_mode = 'deposit_50' THEN\n    RAISE EXCEPTION 'deposit_orders_closed' |   IF p_mode = 'deposit_5O' THEN\n    RAISE EXCEPTION 'deposit_orders_closed'
 * @mutate supabase/migrations/20261108195900_shops_deposit_hidden_pickup_private.sql |              AND (o.fulfillment = 'pickup'\n                  OR (o.fulfillment = 'helpr_delivers' AND o.helpr_unfilled_at IS NOT NULL))\n |
 * @mutate supabase/migrations/20261108195900_shops_deposit_hidden_pickup_private.sql |              AND NOT EXISTS (SELECT 1 FROM public.shop_order_lines l WHERE l.order_id = o.id AND l.at_buyer)\n |
 * @mutate supabase/migrations/20261108200421_shops_services_in_person.sql |   IF NEW.kind IN ('service', 'rental') OR NEW.at_buyer THEN |   IF NEW.kind IN ('rental') THEN
 * @mutate supabase/migrations/20261108200421_shops_services_in_person.sql |     AND NOT (OLD.handover_mode = 'porch' AND NEW.handover_mode = 'in_person' AND OLD.status = 'awaiting_hold' |     AND NOT (OLD.handover_mode = 'porch' AND NEW.handover_mode = 'in_person'
 * @mutate supabase/migrations/20261108201153_shops_notice_kinds.sql |     WHEN p_link LIKE '/shops%' THEN | WHEN p_link LIKE '/shopz%' THEN
 * @mutate src/components/notificationPreferences/constants.tsx |   { key: "shops_orders", emailKey: "email_shops_orders", label: "Orders", |   { key: "new_offers", emailKey: "email_new_offers", label: "Orders",
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { shopsRows } from "@/components/notificationPreferences/constants";
import { NOTIFICATION_TYPE_MAP } from "../../supabase/functions/_shared/notificationTypes";

const MIG_DIR = join(process.cwd(), "supabase/migrations");
const DEFS = effectiveDefs(MIG_DIR);
const flat = (t: string) => t.replace(/\s+/g, " ");
const body = (name: string) => {
  const stmt = blankSqlComments(DEFS.get(name)?.stmt ?? "");
  const m = /\bAS\s+\$\w*\$/i.exec(stmt);
  return m ? flat(stmt.slice(m.index)) : "";
};

describe("shops audit 11-08 #1: half up front stays closed", () => {
  it("the newest shops_set_custom_orders refuses deposit_50 before it writes", () => {
    const b = body("shops_set_custom_orders");
    expect(b.length).toBeGreaterThan(200);
    const refuse = b.indexOf("IF p_mode = 'deposit_50' THEN RAISE EXCEPTION 'deposit_orders_closed'");
    const write = b.indexOf("UPDATE public.shops SET custom_orders");
    expect(refuse).toBeGreaterThan(0);
    expect(write).toBeGreaterThan(refuse);
  });

  it("the newest shops_order_custom_quote still refuses a deposit (so the setter's refusal is still needed)", () => {
    expect(body("shops_order_custom_quote")).toMatch(/RAISE EXCEPTION 'deposit_not_ready'/);
  });
});

describe("shops audit 11-08 #2: the pickup address is for pickups only", () => {
  const b = body("shops_order_pickup_address");
  it("reads the newest body", () => {
    expect(b.length).toBeGreaterThan(200);
  });
  it("a buyer reads it only on a pickup (or a Helpr delivery that fell back to pickup)", () => {
    expect(b).toContain("AND (o.fulfillment = 'pickup' OR (o.fulfillment = 'helpr_delivers' AND o.helpr_unfilled_at IS NOT NULL))");
  });
  it("never for an order with work at the buyer's place", () => {
    expect(b).toContain("AND NOT EXISTS (SELECT 1 FROM public.shop_order_lines l WHERE l.order_id = o.id AND l.at_buyer)");
  });
});

describe("shops audit 11-08 #3: services and at-home work are in person", () => {
  const mig = flat(blankSqlComments(readFileSync(join(MIG_DIR, "20261108200421_shops_services_in_person.sql"), "utf8")));
  it("a service, rental or at-home line moves an unpaid porch order to in person", () => {
    const b = body("shop_order_lines_service_in_person");
    expect(b).toContain("IF NEW.kind IN ('service', 'rental') OR NEW.at_buyer THEN");
    expect(b).toContain("WHERE id = NEW.order_id AND handover_mode = 'porch' AND status = 'awaiting_hold'");
    expect(mig).toContain("CREATE TRIGGER shop_order_lines_service_in_person AFTER INSERT ON public.shop_order_lines");
  });
  it("the newest freeze allows only that move, only before the hold", () => {
    const b = body("shop_orders_handover_mode_frozen");
    expect(b).toContain("RAISE EXCEPTION 'handover_mode_frozen'");
    expect(b).toContain("AND NOT (OLD.handover_mode = 'porch' AND NEW.handover_mode = 'in_person' AND OLD.status = 'awaiting_hold'");
  });
});

describe("shops audit 11-08 #6: Shops notices have their own switches", () => {
  const KINDS = ["shops_orders", "shops_messages", "shops_updates"];
  it("the newest router files a Shops link under a Shops kind before it keeps any other non-Declutter type", () => {
    const b = body("declutter_notice_type");
    const shops = b.indexOf("WHEN p_link LIKE '/shops%' THEN");
    const keep = b.indexOf("WHEN p_link IS NULL OR p_link NOT LIKE '/declutter%' THEN p_type");
    expect(shops).toBeGreaterThan(0);
    expect(keep).toBeGreaterThan(shops);
    expect(b).toContain("THEN 'shops_messages'");
    expect(b).toContain("THEN 'shops_updates'");
    expect(b).toContain("ELSE 'shops_orders' END");
  });
  it("each Shops kind has its own push switch and email twin on the screen", () => {
    expect(shopsRows.map((r) => [r.key, r.emailKey])).toEqual(KINDS.map((k) => [k, `email_${k}`]));
    for (const k of KINDS) expect(NOTIFICATION_TYPE_MAP[k]?.prefCol).toBe(`email_${k}`);
  });
});
