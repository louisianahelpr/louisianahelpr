/**
 * SH12 shop FAQs (20261019072541_shops_faqs.sql): owner-written questions and
 * answers on the shop page. Layers: the table (no client grants, RLS on), the
 * write RPC (switch, ban, owner gates, own shop only, not while hidden,
 * limits, authenticated only), the table's contact triggers, the reads (owner,
 * admin or shop_link_visible, anon + authenticated), the client (new-RPC PGRST202 fallback, a count is
 * the proof of the write) and both shop pages mounting the card at the end.
 * Behaviour proven in PGlite: ~/.lh-pglite/shops-s4b-faqs.mjs (99 asserts, migration applied 3x; a case for
 * each lead /code-review must-fix: joined text, links/handles, table triggers, admin read, hidden write, Cf strip).
 */
// @mutate src/lib/shops/faqs.ts |   if ((error as { code?: string } \| null)?.code === "PGRST202") return [];\n |
// @mutate src/lib/shops/faqs.ts |   if (typeof data !== "number") throw | if (false) throw
// @mutate src/lib/shops/errors.ts |   shop_hidden: "This shop is hidden by Louisiana Helpr right now, so it can't be changed. Contact support.", |   shop_hidden: "Louisiana Helpr hid your shop, so it can't be closed here. Contact support.",
// @mutate src/components/shops/PublicShopView.tsx |       <ShopFaqs shopId={shop.id} />\n |
// @mutate src/components/shops/ShopView.tsx |         <ShopFaqs shopId={s.id} />\n |
// @mutate src/components/shops/ShopOrderSheet.tsx |         <p className="text-xs text-muted-foreground">{ORDER_HOLD_TEXT}</p> |         <p className="text-xs text-muted-foreground">Your card is held, not charged. The shop has 24 hours to accept; your card is charged only if it does.</p>
// @mutate src/lib/shops/faqs.ts |     { key: "cancel", label: "Cancelling", text: cancelPolicyText(p.cancel_policy, p.ready_tap_cancel).label }, |     { key: "cancel", label: "Cancelling", text: "Free to cancel until the shop accepts" },
// @mutate src/components/shops/PublicShopView.tsx |       {shop.offers_selling && <ShopPolicies shopId={shop.id} />}\n |
// @mutate src/components/shops/ShopDashboardView.tsx |         <ShopPayoutRow />\n |
// @mutate supabase/migrations/20261019072541_shops_faqs.sql |   PERFORM public.require_feature('shops');\n  IF public.is_caller_banned() THEN |   IF public.is_caller_banned() THEN
// @mutate supabase/migrations/20261019072541_shops_faqs.sql |   IF v_hidden IS NOT NULL THEN |   IF false THEN
// @mutate supabase/migrations/20261019072541_shops_faqs.sql |   SELECT id, hidden_at INTO v_shop, v_hidden FROM public.shops WHERE owner_id = v_uid FOR UPDATE; |   SELECT id, hidden_at INTO v_shop, v_hidden FROM public.shops LIMIT 1;
// @mutate supabase/migrations/20261019072541_shops_faqs.sql |   v_reason := COALESCE(public.shop_contact_leak_reason(NEW.question), public.shop_contact_leak_reason(NEW.answer)); |   v_reason := NULL;
// @mutate supabase/migrations/20261019072541_shops_faqs.sql |   NEW.question := btrim(public.shop_text_clean(NEW.question)); |   NEW.question := btrim(NEW.question);
// @mutate supabase/migrations/20261019072541_shops_faqs.sql |   ELSIF v ~* '(^\|[^a-z0-9._])@[a-z0-9_][a-z0-9._]+' THEN |   ELSIF false THEN
// @mutate supabase/migrations/20261019072541_shops_faqs.sql |     v_reason := public.shop_contact_leak_reason(NEW.about); v_where := 'about'; |     v_reason := public.contact_leak_reason(NEW.about); v_where := 'about';
// @mutate supabase/migrations/20261019072541_shops_faqs.sql |        OR COALESCE(public.has_role(v_uid, 'admin'::app_role), false)) THEN |        OR false) THEN
// @mutate supabase/migrations/20261019072541_shops_faqs.sql |   RETURN COALESCE(public.shop_link_visible(p_shop_id), false); |   RETURN true;
// @mutate supabase/migrations/20261019072541_shops_faqs.sql |   RETURN (SELECT jsonb_build_object('cancel_policy', s.cancel_policy, 'ready_tap_cancel', s.ready_tap_cancel) |   RETURN (SELECT jsonb_build_object('cancel_policy', s.cancel_policy, 'ready_tap_cancel', s.ready_tap_cancel, 'owner_id', s.owner_id)
// @mutate supabase/migrations/20261019072541_shops_faqs.sql | REVOKE ALL ON FUNCTION public.shops_set_my_faqs(jsonb) FROM PUBLIC, anon; | REVOKE ALL ON FUNCTION public.shops_set_my_faqs(jsonb) FROM PUBLIC;
// @mutate supabase/migrations/20261019072541_shops_faqs.sql | REVOKE ALL ON TABLE public.shop_faqs FROM PUBLIC, anon, authenticated; | GRANT SELECT ON TABLE public.shop_faqs TO anon;
// @mutate supabase/migrations/20261019072541_shops_faqs.sql |     normalize(p_text, NFKC), |     p_text,
// @mutate supabase/migrations/20261019072541_shops_faqs.sql |     v_reason := COALESCE(public.shop_contact_leak_reason(v_spaced), public.shop_contact_leak_reason(v_tight), |     v_reason := COALESCE(NULL, NULL,
// @mutate supabase/migrations/20261019072541_shops_faqs.sql |                          public.shop_contact_leak_reason(v_a_spaced), public.shop_contact_leak_reason(v_a_tight)); |                          NULL);
// @mutate supabase/migrations/20261019072541_shops_faqs.sql |   v_going_live boolean := TG_OP = 'UPDATE' AND NEW.status = 'live' AND OLD.status IS DISTINCT FROM 'live'; |   v_going_live boolean := false;
// @mutate supabase/migrations/20261019072541_shops_faqs.sql |     v_reason := public.shop_contact_leak_reason(NEW.description); v_where := 'description'; |     v_reason := public.contact_leak_reason(NEW.description); v_where := 'description';
// @mutate supabase/migrations/20261019072541_shops_faqs.sql |       IF r.status = 'live' THEN |       IF false THEN
// @mutate supabase/migrations/20261019072541_shops_faqs.sql |   FOR r IN SELECT id, name, about, area_label FROM public.shops WHERE hidden_at IS NULL LOOP | DELETE FROM public.shops WHERE false;\n  FOR r IN SELECT id, name, about, area_label FROM public.shops WHERE hidden_at IS NULL LOOP
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const defs = effectiveDefs(join(ROOT, "supabase", "migrations"));

describe("SH12 FAQs: the server", () => {
  const set = defs.get("shops_set_my_faqs");
  const get = defs.get("shops_shop_faqs");
  const pol = defs.get("shops_shop_policies");
  const readable = defs.get("shop_extras_readable");
  const leak = defs.get("shop_contact_leak_reason");
  const rowTrig = defs.get("shop_faq_clean_and_check");
  const joined = defs.get("shop_faqs_check_joined");
  const clean = defs.get("shop_text_clean");
  const migSql = () => blankSqlComments(read(join("supabase", "migrations", set!.file)));

  it("every function exists (newest definition)", () => {
    expect(defs.size).toBeGreaterThan(100);
    for (const d of [set, get, pol, readable, leak, rowTrig, joined, clean]) expect(d).toBeTruthy();
  });

  it("the write: switch, ban, owner gates, own shop, not while admin-hidden, limits", () => {
    const body = blankSqlComments(set!.stmt);
    const order = ["require_feature('shops')", "is_caller_banned()", "shops_assert_owner_eligible()", "WHERE owner_id = v_uid FOR UPDATE", "IF v_hidden IS NOT NULL THEN"].map((x) => body.indexOf(x));
    for (const i of order) expect(i).toBeGreaterThan(0);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(body).toMatch(/RAISE EXCEPTION 'shop_hidden'/);
    expect(body).toMatch(/jsonb_array_length\(p_faqs\) > 10/);
    expect(body).toMatch(/char_length\(v_q\) NOT BETWEEN 3 AND 140 OR char_length\(v_a\) NOT BETWEEN 1 AND 600/);
  });

  it("the TABLE enforces the contact rules: a row trigger (clean, then check) and a joined-text statement trigger", () => {
    const sql = migSql();
    expect(sql).toMatch(/CREATE TRIGGER trg_shop_faq_clean_and_check\s+BEFORE INSERT OR UPDATE OF question, answer ON public\.shop_faqs\s+FOR EACH ROW EXECUTE FUNCTION public\.shop_faq_clean_and_check\(\);/);
    expect(sql).toMatch(/CREATE TRIGGER trg_shop_faqs_check_joined_ins\s+AFTER INSERT ON public\.shop_faqs\s+REFERENCING NEW TABLE AS new_rows\s+FOR EACH STATEMENT EXECUTE FUNCTION public\.shop_faqs_check_joined\(\);/);
    expect(sql).toMatch(/CREATE TRIGGER trg_shop_faqs_check_joined_upd\s+AFTER UPDATE ON public\.shop_faqs/);
    const row = blankSqlComments(rowTrig!.stmt);
    expect(row.indexOf("NEW.question := btrim(public.shop_text_clean(NEW.question));")).toBeGreaterThan(0);
    expect(row.indexOf("NEW.answer := btrim(public.shop_text_clean(NEW.answer));")).toBeGreaterThan(0);
    expect(row.indexOf("shop_contact_leak_reason(NEW.question)")).toBeGreaterThan(row.indexOf("shop_text_clean(NEW.answer)"));
    const j = blankSqlComments(joined!.stmt);
    expect(j).toMatch(/string_agg\(f\.question \|\| ' ' \|\| f\.answer, ' ' ORDER BY f\.position\)/);
    expect(j).toMatch(/string_agg\(f\.question \|\| f\.answer, '' ORDER BY f\.position\)/);
    expect(j).toMatch(/v_reason := COALESCE\(public\.shop_contact_leak_reason\(v_spaced\), public\.shop_contact_leak_reason\(v_tight\),/);
  });

  it("the shop filter: the app-wide one on cleaned text, plus links, domains, handles and social accounts; the shop profile uses it too", () => {
    const body = blankSqlComments(leak!.stmt);
    expect(body).toMatch(/v text := public\.shop_text_clean\(p_text\);/);
    expect(body).toMatch(/v_reason := public\.contact_leak_reason\(v\);/);
    for (const r of ["'Website link detected'", "'Social media handle detected'", "'Social media account mentioned'"]) expect(body).toContain(r);
    expect(blankSqlComments(clean!.stmt)).toContain("\\u200B-\\u200F");
    const shopTrig = defs.get("reject_contact_leak_in_shop");
    expect(shopTrig?.file).toBe(set!.file);
    const t = blankSqlComments(shopTrig!.stmt);
    expect((t.match(/public\.shop_contact_leak_reason\(NEW\.(name|about|area_label)\)/g) ?? []).length).toBe(3);
    expect(t).not.toMatch(/public\.contact_leak_reason\(/);
    expect(t).toMatch(/websites and social accounts/);
    // Every refusal ends with the sentence shopsErrorMessage shows as written (src/lib/shops/errors.ts).
    const sql = migSql();
    const msgs = [...sql.matchAll(/MESSAGE = (v_reason \|\|[^\n]*');$/gm)].map((m) => m[1]);
    expect(msgs.length).toBe(4); // shop profile, FAQ row, FAQ joined, items
    for (const m of msgs) expect(m).toMatch(/does not allow contact details in Shops\.'$/);
    expect(sql).not.toMatch(/Message button/);
  });

  it("the reads: owner, admin, or the public page's own rule; one helper for both", () => {
    const r = blankSqlComments(readable!.stmt);
    expect(r).toMatch(/s\.owner_id = v_uid/);
    expect(r).toMatch(/public\.has_role\(v_uid, 'admin'::app_role\)/);
    expect(r).toMatch(/RETURN COALESCE\(public\.shop_link_visible\(p_shop_id\), false\);/);
    for (const d of [get, pol]) expect(blankSqlComments(d!.stmt)).toMatch(/IF NOT public\.shop_extras_readable\(p_shop_id\) THEN\s+RETURN NULL;/);
    expect(blankSqlComments(get!.stmt)).toMatch(/jsonb_build_object\('question', f\.question, 'answer', f\.answer\)/);
    const keys = [...blankSqlComments(pol!.stmt).matchAll(/jsonb_build_object\(([^)]*)\)/g)].flatMap((m) => [...m[1].matchAll(/'(\w+)'/g)].map((k) => k[1]));
    expect(keys).toEqual(["cancel_policy", "ready_tap_cancel"]);
  });

  it("grants: write authenticated only, reads anon + authenticated, helpers internal, no client table access", () => {
    const sql = migSql();
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.shops_set_my_faqs\(jsonb\) FROM PUBLIC, anon;/);
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.shops_set_my_faqs\(jsonb\) TO [^;]*\banon\b/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.shops_shop_faqs\(uuid\) TO anon, authenticated, service_role;/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.shops_shop_policies\(uuid\) TO anon, authenticated, service_role;/);
    for (const f of ["shop_text_clean(text)", "shop_contact_leak_reason(text)", "shop_extras_readable(uuid)"]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${f} FROM PUBLIC, anon, authenticated;`);
    }
    expect(sql).toMatch(/ALTER TABLE public\.shop_faqs ENABLE ROW LEVEL SECURITY;/);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.shop_faqs FROM PUBLIC, anon, authenticated;/);
    expect(sql).not.toMatch(/GRANT [A-Z, ]+ ON TABLE public\.shop_faqs TO [^;]*\b(anon|authenticated)\b/);
  });

  it("the migration holds no invisible characters itself (escapes only)", () => {
    const raw = read(join("supabase", "migrations", set!.file));
    expect([...raw].filter((c) => c.charCodeAt(0) > 127)).toEqual([]);
  });
});

describe("SH12 v2 (lead re-review): the shop filter closes the bypasses", () => {
  const sqlRaw = () => read(join("supabase", "migrations", defs.get("shops_set_my_faqs")!.file));

  it("shop_text_clean NFKC-normalizes first, then strips a list that covers the WHOLE invisible classes", () => {
    const clean = blankSqlComments(defs.get("shop_text_clean")!.stmt);
    expect(clean).toMatch(/regexp_replace\(\s*normalize\(p_text, NFKC\),/);
    const bracket = /normalize\(p_text, NFKC\),\s*'\[([^\]]+)\]'/.exec(clean)?.[1] ?? "";
    const BS = String.fromCharCode(92);
    const toks = [...bracket.matchAll(new RegExp(`${BS}${BS}(?:u([0-9A-F]{4})|U([0-9A-F]{8}))(?:-${BS}${BS}(?:u([0-9A-F]{4})|U([0-9A-F]{8})))?`, "g"))];
    expect(toks.length).toBeGreaterThan(20);
    const ranges = toks.map((m) => {
      const lo = parseInt(m[1] ?? m[2], 16);
      const hiHex = m[3] ?? m[4];
      return [lo, hiHex ? parseInt(hiHex, 16) : lo] as const;
    });
    const covered = (cp: number) => ranges.some(([lo, hi]) => cp >= lo && cp <= hi);
    const missing: string[] = [];
    const cf = /\p{Cf}/u;
    const vs = /\p{Variation_Selector}/u;
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const ch = String.fromCodePoint(cp);
      if ((cf.test(ch) || vs.test(ch)) && !covered(cp)) missing.push(cp.toString(16));
    }
    expect(missing, "Cf / variation selectors not in shop_text_clean's list").toEqual([]);
    for (const cp of [0x034f, 0x115f, 0x1160, 0x3164, 0xffa0, 0x2800]) expect(covered(cp), cp.toString(16)).toBe(true);
  });

  it("the joined check also reads the questions alone and the answers alone", () => {
    const j = blankSqlComments(defs.get("shop_faqs_check_joined")!.stmt);
    for (const agg of ["string_agg(f.question, ' ' ORDER BY f.position)", "string_agg(f.question, '' ORDER BY f.position)", "string_agg(f.answer, ' ' ORDER BY f.position)", "string_agg(f.answer, '' ORDER BY f.position)"]) expect(j).toContain(agg);
    for (const v of ["v_spaced", "v_tight", "v_q_spaced", "v_q_tight", "v_a_spaced", "v_a_tight"]) expect(j).toContain(`public.shop_contact_leak_reason(${v})`);
  });

  it("social: unambiguous platform names anywhere, ig/snap/threads/tt only in a social context, handles may start with a digit", () => {
    const body = blankSqlComments(defs.get("shop_contact_leak_reason")!.stmt);
    expect(body).toMatch(/@\[a-z0-9_\]\[a-z0-9\._\]\+/);
    expect(body).toMatch(/instagram\|insta\|facebook\|fb\|tiktok\|snapchat\|twitter\|linktree\|youtube\|pinterest/);
    expect(body).toMatch(/linktr\\\.ee/);
    expect(body).toMatch(/\(on\|at\|via\|follow\|find\|add\|dm\|message\|my\|our\)[^']*\(ig\|snap\|threads\|tt\)/);
    expect(body).toMatch(/\(ig\|snap\|threads\|tt\)\\s\*\[:@\]/);
  });

  it("items use the shop filter, re-checked when an item goes live", () => {
    const item = defs.get("reject_contact_leak_in_shop_item");
    expect(item?.file).toBe(defs.get("shops_set_my_faqs")!.file);
    const t = blankSqlComments(item!.stmt);
    expect((t.match(/public\.shop_contact_leak_reason\(NEW\.(title|description)\)/g) ?? []).length).toBe(2);
    expect(t).not.toMatch(/public\.contact_leak_reason\(/);
    expect(t).toMatch(/v_going_live boolean := TG_OP = 'UPDATE' AND NEW\.status = 'live' AND OLD\.status IS DISTINCT FROM 'live';/);
    expect(t).toMatch(/does not allow contact details in Shops\.';/);
    expect(blankSqlComments(sqlRaw())).toMatch(/CREATE TRIGGER trg_reject_contact_leak_in_shop_item\s+BEFORE INSERT OR UPDATE OF title, description, status ON public\.shop_items/);
  });

  it("the backfill flags, never deletes: failing shops hidden with the reason, failing items flagged, live ones back to review", () => {
    const sql = blankSqlComments(sqlRaw());
    const bf = /DO (\$\w*\$)([\s\S]*?)\1;/.exec(sql)?.[2] ?? "";
    expect(bf.length).toBeGreaterThan(200);
    expect(bf).not.toMatch(/\bDELETE\b/i);
    expect(bf).toMatch(/FROM public\.shops WHERE hidden_at IS NULL/);
    expect(bf).toMatch(/SET hidden_at = now\(\),\s+hidden_reason = left\('Hidden for review by the stricter Shops contact filter \(SH12\): '/);
    expect(bf).toMatch(/INSERT INTO public\.shop_item_private \(item_id, owner_id, text_flag_reason\)/);
    expect(bf).toMatch(/IF r\.status = 'live' THEN\s+UPDATE public\.shop_items SET status = 'pending_review', submitted_at = now\(\), admin_approved_at = NULL/);
    expect(bf).not.toMatch(/SET (title|description|about|name) =/);
  });
});

describe("SH12 FAQs: both shop pages show them, at the end", () => {
  it("ShopView and PublicShopView mount ShopFaqs after the gallery", () => {
    for (const [file, id] of [["src/components/shops/ShopView.tsx", "s.id"], ["src/components/shops/PublicShopView.tsx", "shop.id"]] as const) {
      const src = blankComments(read(file));
      const faq = src.indexOf(`<ShopFaqs shopId={${id}} />`);
      expect(faq, file).toBeGreaterThan(0);
      expect(faq, `${file}: after the gallery`).toBeGreaterThan(src.indexOf("<ShopGallery"));
      // The policies card, for a shop that sells, just before the FAQs.
      const sells = id === "s.id" ? "s.offers_selling" : "shop.offers_selling";
      const pol = src.indexOf(`{${sells} && <ShopPolicies shopId={${id}} />}`);
      expect(pol, `${file}: ShopPolicies behind offers_selling`).toBeGreaterThan(0);
      expect(pol).toBeLessThan(faq);
    }
  });

  it("the shop dashboard carries the payout row, the Profile's own (no second payout screen)", () => {
    const dash = blankComments(read("src/components/shops/ShopDashboardView.tsx"));
    expect(dash).toMatch(/<ShopPayoutRow \/>/);
    const row = blankComments(read("src/components/shops/ShopPayoutRow.tsx"));
    expect(row).toMatch(/useStripeConnectStatus\(\)/);
    expect(row).toMatch(/<PayoutStatusRow prompt=\{payoutPrompt\}/);
    expect(row).toMatch(/navigate\("\/profile\?tab=payment"\)/);
  });
});

describe("SH12 shop policies: one wording source", () => {
  it("the policy lines are the order sheet's own words", async () => {
    vi.resetModules();
    vi.doMock("@/integrations/supabase/client", () => ({ supabase: {} }));
    const { shopPolicyLines } = await import("@/lib/shops/faqs");
    const { cancelPolicyText, ORDER_HOLD_TEXT } = await import("@/lib/shops/orders");
    for (const [cp, rt] of [["until_accept", "from_day_before"], ["until_handover", "ends_at_tap"], ["until_handover", "never_shortens"], ["until_24h_before_ready", "ends_at_tap"]] as const) {
      const lines = shopPolicyLines({ cancel_policy: cp, ready_tap_cancel: rt });
      expect(lines.map((l) => l.text)).toEqual([cancelPolicyText(cp, rt).label, ORDER_HOLD_TEXT]);
    }
  });

  it("the hold sentence is written once (orders.ts), never a second literal", () => {
    const sheet = blankComments(read("src/components/shops/ShopOrderSheet.tsx"));
    expect(sheet).toMatch(/\{ORDER_HOLD_TEXT\}/);
    expect(sheet).not.toMatch(/Your card is held, not charged/);
  });
});

describe("shop_hidden copy fits every write it is mapped to (lead 2026-10-19)", () => {
  it("one neutral line, never about closing, and the FAQ save uses it", () => {
    const errors = blankComments(read("src/lib/shops/errors.ts"));
    const line = /shop_hidden: "([^"]+)"/.exec(errors)?.[1] ?? "";
    expect(line).toBe("This shop is hidden by Louisiana Helpr right now, so it can't be changed. Contact support.");
    const copy = blankComments(read("src/lib/shops/rpcErrorCopy.ts"));
    const mapped = [...copy.matchAll(/shop_hidden: SC\.(\w+)/g)].map((m) => m[1]);
    expect(mapped.length).toBeGreaterThan(5);
    expect(new Set(mapped)).toEqual(new Set(["shop_hidden"]));
    expect(copy).toMatch(/shops_set_my_faqs: \{[^}]*shop_hidden: SC\.shop_hidden,/);
  });
});

describe("SH12 FAQs: the client", () => {
  const rpc = vi.fn();
  beforeEach(() => {
    rpc.mockReset();
    vi.resetModules();
    vi.doMock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
  });

  it("a not-yet-deployed read (PGRST202) shows no card instead of an error", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "not found" } });
    const { fetchShopFaqs } = await import("@/lib/shops/faqs");
    await expect(fetchShopFaqs("s1")).resolves.toEqual([]);
  });

  it("a save drops blank rows, trims, and needs the server's count", async () => {
    rpc.mockResolvedValue({ data: 1, error: null });
    const { saveMyShopFaqs } = await import("@/lib/shops/faqs");
    await expect(saveMyShopFaqs([{ question: "  Deliver? ", answer: " No. " }, { question: " ", answer: "" }])).resolves.toBe(1);
    expect(rpc).toHaveBeenCalledWith("shops_set_my_faqs", { p_faqs: [{ question: "Deliver?", answer: "No." }] });
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(saveMyShopFaqs([{ question: "Deliver?", answer: "No." }])).rejects.toThrow("faqs_not_saved");
  });

  it("a refusal carries the shop words", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "invalid_faqs" } });
    const { saveMyShopFaqs } = await import("@/lib/shops/faqs");
    await expect(saveMyShopFaqs([{ question: "Q?", answer: "A" }])).rejects.toMatchObject({ userMessage: expect.stringContaining("at most 10 questions") });
  });
});
