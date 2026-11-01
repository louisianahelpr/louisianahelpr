/**
 * NO BUYER OR GUEST READ RETURNS A PICKUP PLACE'S LABEL (owner 2026-10-31 11:42 PM, OWNER-DECISIONS "Declutter item
 * page layout": "Pickup places show the CITY only, never the place's label"). The label ("Home", "Mom's house") is
 * the seller's own note; buyers get the place's city (area), and the address only after paying.
 *
 * For the NEWEST definition of every function that reads declutter_porch_places or declutter_order_porch_places,
 * each `<alias>.label` it reads must be one of:
 *   - gated to the seller: `CASE WHEN <seller check> THEN x.label END`,
 *   - copied, not returned: the checkout's INSERT ... VALUES freezing the pick on the order,
 *   - the seller's own list: declutter_my_porch_places, which reads only `pl.seller_id = v_uid`.
 * And no WHOLE-ROW read of a place table (to_jsonb / to_json / row_to_json / jsonb_agg / json_agg of the row or the
 * bare table name, t.*, or a SELECT * in any statement naming a place table that is returned rather than read INTO a
 * variable) reaches anyone but the seller, unless it subtracts 'label' (review 2026-11-01: the
 * buyer's data export kept it). A whole row is allowed in a seller branch (`CASE WHEN t.seller_id = v_uid THEN`)
 * or a statement that reads only the seller's own rows (`WHERE t.seller_id = v_uid`).
 * Behaviour (buyer null, seller label, address after paying) is proven in
 * src/test/pglite/declutterPlacesCityOnly.pglite.mjs.
 *
 * @mutate supabase/migrations/20261101054401_declutter_places_city_only_for_buyers.sql | SELECT CASE WHEN v_seller = v_uid THEN pl.label END, pl.area, | SELECT pl.label, pl.area,
 * @mutate supabase/migrations/20261101054401_declutter_places_city_only_for_buyers.sql | SELECT pl.id, CASE WHEN pl.seller_id = v_uid THEN pl.label END, pl.area, | SELECT pl.id, pl.label, pl.area,
 * @mutate supabase/migrations/20261101054401_declutter_places_city_only_for_buyers.sql | SELECT CASE WHEN v_side = 'seller' THEN pp.label END, pp.area, | SELECT pp.label, pp.area,
 * @mutate supabase/migrations/20261101054401_declutter_places_city_only_for_buyers.sql | SELECT CASE WHEN v_side = 'seller' THEN pp.label END, pp.area, | SELECT CASE WHEN true THEN pp.label END, pp.area,
 * @mutate supabase/migrations/20261101061156_export_my_data_place_city_only.sql | - 'seller_id' - 'label' END), '[]'::jsonb) FROM public.declutter_order_porch_places t | - 'seller_id' END), '[]'::jsonb) FROM public.declutter_order_porch_places t
 * @mutate supabase/migrations/20261101061156_export_my_data_place_city_only.sql | FROM public.declutter_porch_places t\n      WHERE t.seller_id = v_uid)); | FROM public.declutter_porch_places t\n      WHERE true));
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { latestFunctionDefs } from "./helpers/rpcErrorInventory";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIGRATIONS = resolve(import.meta.dirname, "../../supabase/migrations");
const defs = latestFunctionDefs(MIGRATIONS);
const readers = [...defs].filter(([, d]) => /\bdeclutter_(?:order_)?porch_places\b/.test(blankSqlComments(d.body)));

/** A CASE that hands the label only to the seller: the condition names the seller. */
const SELLER_GATE = /CASE\s+WHEN\s+(?:v_side\s*=\s*'seller'|v_seller\s*=\s*v_uid|\w+\.seller_id\s*=\s*v_uid)\s+THEN\s+\w+\.label\s+END/g;

function ungatedLabels(name: string, body: string): string[] {
  let b = blankSqlComments(body).replace(SELLER_GATE, "<seller-only>");
  // The checkout copies the chosen place onto the order (not a read anyone gets back).
  b = b.replace(/INSERT\s+INTO\s+public\.declutter_order_porch_places[\s\S]*?VALUES\s*\([^;]*?\);/g, "<freeze>");
  if (name === "declutter_my_porch_places" && /WHERE\s+pl\.seller_id\s*=\s*v_uid/.test(b)) return [];
  return [...b.matchAll(/[^\n]*\b\w+\.label\b[^\n]*/g)].map((m) => `${name}: ${m[0].trim()}`);
}

/** A place table, schema-qualified or not, with the alias it is read under (if any). */
const PLACE_TABLE = /\b(?:public\.)?(declutter_(?:order_)?porch_places)\b(?!\s*%)(?:\s+(?:AS\s+)?(?!(?:WHERE|ON|JOIN|LEFT|RIGHT|INNER|FULL|CROSS|ORDER|LIMIT|GROUP|SET|USING|VALUES|SELECT|INTO|AND|OR|WHEN|THEN|ELSE|END|RETURNING|FOR|UNION|HAVING|OFFSET)\b)(\w+))?/gi;
/** Every function that turns a whole row into JSON. */
const WHOLE_ROW_FNS = "(?:to_jsonb|to_json|row_to_json|jsonb_agg|json_agg)";

/** Whole-row reads of a place table that could carry its label to someone other than the seller. */
function wholeRowLeaks(name: string, body: string): string[] {
  const out: string[] = [];
  for (const stmt of blankSqlComments(body).split(";")) {
    const hits = [...stmt.matchAll(PLACE_TABLE)];
    if (hits.length === 0) continue;
    // A row is named by its alias, or by the bare table name when it has none.
    const names = [...new Set(hits.map((m) => m[2] ?? m[1]))];
    let s = stmt.replace(/\s+/g, " ");
    // SELECT * read INTO a variable is not returned.
    s = s.replace(/SELECT\s+(?:\w+\.)?\*\s+INTO\b/gi, "<into>");
    // Any statement that names a place table: a bare SELECT * returns every column of every table it reads.
    if (/\bSELECT\s+\*/i.test(s)) out.push(`${name}: SELECT * in a statement that reads a place table`);
    for (const a of names) {
      const ownRows = new RegExp(`WHERE ${a}\\.seller_id = v_uid\\b(?!\\s*(?:OR|AND))`).test(s);
      if (ownRows) continue;
      s = s
        .replace(new RegExp(`WHEN ${a}\\.seller_id = v_uid THEN ${WHOLE_ROW_FNS}\\(${a}\\)`, "g"), "<seller-only>")
        .replace(new RegExp(`${WHOLE_ROW_FNS}\\(${a}\\)((?:\\s*-\\s*'\\w+')+)`, "g"), (m, minus: string) => (/'label'/.test(minus) ? "<no-label>" : m));
      for (const m of s.matchAll(new RegExp(`${WHOLE_ROW_FNS}\\((?:public\\.)?${a}\\)(?:\\s*-\\s*'\\w+')*|\\b${a}\\.\\*`, "g"))) out.push(`${name}: ${m[0]}`);
    }
  }
  return out;
}

describe("buyers and guests never get a pickup place's label from the server", () => {
  it("reads every function that touches the place tables", () => {
    expect(defs.size).toBeGreaterThan(500);
    expect(readers.length).toBeGreaterThan(10);
    for (const fn of ["declutter_item_pickup_places", "declutter_seller_porch_places", "declutter_order_place", "declutter_my_porch_places"]) {
      expect(readers.map(([n]) => n)).toContain(fn);
    }
  });

  it("every label read is seller-only, a copy onto the order, or the seller's own list", () => {
    expect(readers.flatMap(([n, d]) => ungatedLabels(n, d.body))).toEqual([]);
  });

  it("no whole-row read of a place table reaches a buyer with its label (export, row_to_json, SELECT *)", () => {
    expect(readers.flatMap(([n, d]) => wholeRowLeaks(n, d.body))).toEqual([]);
    // The inventory is real: the export reads both place tables whole.
    expect(blankSqlComments(defs.get("export_my_data")?.body ?? "")).toMatch(/to_jsonb\(t\)[\s\S]*declutter_order_porch_places/);
  });

  it("the check itself flags a buyer's whole row, and passes a seller branch or a label-free copy", () => {
    const fn = (sql: string) => wholeRowLeaks("x", sql);
    expect(fn("SELECT jsonb_agg(to_jsonb(t) - 'address') FROM public.declutter_order_porch_places t WHERE t.order_id = o")).toHaveLength(1);
    expect(fn("SELECT row_to_json(pp) FROM public.declutter_porch_places pp WHERE pp.area = 'x'")).toHaveLength(1);
    expect(fn("RETURN QUERY SELECT * FROM public.declutter_porch_places WHERE seller_id = p")).toHaveLength(1);
    expect(fn("SELECT CASE WHEN t.seller_id = v_uid THEN to_jsonb(t) ELSE to_jsonb(t) - 'address' - 'label' END FROM public.declutter_order_porch_places t WHERE true")).toEqual([]);
    expect(fn("SELECT jsonb_agg(to_jsonb(t)) FROM public.declutter_porch_places t WHERE t.seller_id = v_uid")).toEqual([]);
    expect(fn("SELECT * INTO v_pp FROM public.declutter_order_porch_places WHERE order_id = o")).toEqual([]);
    expect(fn("SELECT pl.* INTO v_place FROM public.declutter_porch_places pl WHERE pl.id = p")).toEqual([]);
    expect(fn("RETURN QUERY SELECT pl.* FROM public.declutter_porch_places pl WHERE pl.id = p")).toHaveLength(1);
    // review 2026-11-01: a SELECT * after a JOIN, to_json / json_agg / jsonb_agg, a bare table name, an unqualified table.
    expect(fn("RETURN QUERY SELECT * FROM public.declutter_items i JOIN public.declutter_porch_places pl ON pl.id = i.place_id")).toHaveLength(1);
    expect(fn("SELECT to_json(t) FROM public.declutter_porch_places t WHERE t.area = 'x'")).toHaveLength(1);
    expect(fn("SELECT json_agg(t) FROM public.declutter_order_porch_places t WHERE t.order_id = o")).toHaveLength(1);
    expect(fn("SELECT jsonb_agg(t) FROM public.declutter_order_porch_places t WHERE t.order_id = o")).toHaveLength(1);
    expect(fn("SELECT to_jsonb(declutter_porch_places) FROM public.declutter_porch_places WHERE area = 'x'")).toHaveLength(1);
    expect(fn("SELECT row_to_json(t) FROM declutter_porch_places t WHERE t.area = 'x'")).toHaveLength(1);
    expect(fn("SELECT jsonb_agg(to_jsonb(t) - 'label') FROM declutter_order_porch_places t WHERE t.order_id = o")).toEqual([]);
    expect(fn("SELECT * INTO v_row FROM public.declutter_items i JOIN public.declutter_porch_places pl ON pl.id = i.place_id")).toEqual([]);
    expect(fn("UPDATE public.declutter_porch_places SET area = 'x' WHERE id = p")).toEqual([]);
  });

  it("the three buyer reads hand the label to the seller only", () => {
    const body = (fn: string) => blankSqlComments(defs.get(fn)?.body ?? "").replace(/\s+/g, " ");
    expect(body("declutter_item_pickup_places")).toContain("SELECT CASE WHEN v_seller = v_uid THEN pl.label END, pl.area,");
    expect(body("declutter_seller_porch_places")).toContain("SELECT pl.id, CASE WHEN pl.seller_id = v_uid THEN pl.label END, pl.area,");
    expect(body("declutter_order_place")).toContain("SELECT CASE WHEN v_side = 'seller' THEN pp.label END, pp.area,");
  });
});
