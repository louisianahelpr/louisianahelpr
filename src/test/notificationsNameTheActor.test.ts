/**
 * Owner report 2026-10-21 (Notifications sheet, 375): "New application" read `Someone applied to "Clean a
 * 2-bedroom house"`, and the owner asked: "Instead of saying someone say who applied." The CLASS: a
 * notification whose actor is known says who, as "First L." (the member-name rule: member_display_name
 * in SQL, memberDisplayName / memberDisplayNameOf at the edge). "Someone" stays only where the actor is
 * unknown, where naming them would show more than the reader may see (a block, a double-blind review,
 * a private wanted post, a referral code's users), or as the fallback for a blank name.
 *
 * Inventory, from source (src/test/helpers/notificationProducers.ts and effectiveFunctionDefs.ts):
 *  - SQL: every function that writes a notification row (its EFFECTIVE definition), plus every function
 *    that calls one (declutter_wanted_record_match hands its words to declutter_wanted_notify);
 *  - edge: every edge file that writes a notification row, plus the create-notification templates;
 *  - client: every src/ file that inserts into notifications.
 * Every string literal there that contains the word "Someone" is an offence, unless it is the bare
 * fallback 'Someone' passed to the name helper (or COALESCE'd / ||'d / ??'d onto a name), or the
 * producer is listed below with why. Comments never count. Both lists are exact and two-way.
 * Behaviour (the trigger, a block, the backfill, 3x replay): src/test/pglite/applicationNoticeNamesTheApplicant.pglite.mjs.
 *
 * @mutate supabase/migrations/20261030150630_applicant_nudges_and_filled_notice.sql | v_message := COALESCE(v_applicant, 'Someone') \|\| ' applied to "' \|\| job_title \|\| '"'; | v_message := 'Someone applied to "' \|\| job_title \|\| '"';
 * @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts | message: `${tipperName} tipped you for a completed job. Thanks for the great work!`, | message: `Someone tipped you for a completed job. Thanks for the great work!`,
 * @mutate supabase/functions/_shared/heldTipRepay.ts | message: `${tipperName} tipped you for a completed job. Thanks for the great work!`, | message: `Someone tipped you for a completed job. Thanks for the great work!`,
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { sqlProducers, edgeProducers } from "./helpers/notificationProducers";
import { walkSource } from "./helpers/walkSource";
import { memberDisplayNameOf } from "../../supabase/functions/_shared/memberDisplayName";

const ROOT = process.cwd();

/** SQL functions that may write "Someone" for a person. name -> why. Exact and two-way. */
const SQL_SOMEONE_OK: Record<string, string> = {
  declutter_hold_unchecked_listings:
    "'Someone from Louisiana Helpr will look at it': the seller's held-listing notice; no person is known yet (an admin picks it up later), so there is no actor to name (20261031152545)",
  declutter_record_ai_check:
    "'Someone from Louisiana Helpr will look at it': the seller's flagged-listing notice; no person is known yet (an admin picks it up later), so there is no actor to name (20261031152545)",
  declutter_request_free:
    "HINT 'Someone else got this item first.': the same error as declutter_take_item's, on an ask for a free item the giver already gave (moved from declutter_claim_free, which now only calls this, Q2487)",
  declutter_question_notice:
    "'Someone asked about ...': who asked a Declutter question is never shown to the seller (Q2278, src/test/declutterQuestionAskerHidden.test.ts; the item page says \"Asked by a neighbor\")",
  declutter_take_item:
    "HINT 'Someone else got this item first.': an error to the member trying to take an item, not a notice; the member who got it first is a stranger the app never names to them",
  declutter_wanted_record_match:
    "'Someone near you wants one': a wanted post is private to its poster (RLS 'poster reads own'); a seller never learns who wants an item",
  notify_user_on_review:
    "the HELD branch only ('Someone reviewed you'): the review is double-blind until both sides review or 14 days pass (20260831162131), and RLS hides a held review from its subject; the revealed branch names the reviewer",
};

/** Edge/client files that may write "Someone" for a person. path -> why. Exact and two-way. */
const TS_SOMEONE_OK: Record<string, string> = {
  "supabase/functions/check-pro-subscription/index.ts":
    "'Someone you referred upgraded': the referrer is never shown who signed up with their code (the Referrals tab shows a count, no names)",
};

const defs = effectiveDefs(join(ROOT, "supabase", "migrations"));
const producers = sqlProducers(ROOT);

/** Producers, and every function whose body calls one (it composes the words the producer writes). */
function sqlInventory(): string[] {
  // Transitive: a function that calls a function that calls a producer feeds it too. Since
  // 20261028162048 declutter_notify wraps the producer declutter_notify_strict, so the ~70
  // Declutter RPCs that call declutter_notify are two steps from the insert.
  const set = new Set(producers);
  for (let grew = true; grew; ) {
    grew = false;
    const callsProducer = new RegExp(`\\b(?:public\\s*\\.\\s*)?(?:${[...set].join("|")})\\s*\\(`, "i");
    for (const [name, def] of defs) {
      if (set.has(name)) continue;
      const body = blankSqlComments(def.stmt).replace(/^[\s\S]*?\bas\s+(\$\w*\$)/i, "");
      if (callsProducer.test(body)) { set.add(name); grew = true; }
    }
  }
  return [...set].sort();
}

/** The 'Someone' literals in a SQL body that are not a name fallback. */
export function sqlSomeoneOffences(stmt: string): string[] {
  const code = blankSqlComments(stmt);
  const out: string[] = [];
  for (const m of code.matchAll(/'(?:[^']|'')*'/g)) {
    const lit = m[0];
    if (!/\bSomeone\b/.test(lit)) continue;
    if (lit === "'Someone'") {
      const before = code.slice(Math.max(0, m.index! - 240), m.index!);
      if (/(?:member_display_name\s*\([^;']*,|coalesce\s*\(\s*[\w.]+\s*,)\s*$/i.test(before)) continue;
    }
    out.push(lit);
  }
  return out;
}

/** The "Someone" string/template literals in TypeScript that are not a name fallback. */
export function tsSomeoneOffences(source: string): string[] {
  const sf = ts.createSourceFile("x.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    let text: string | null = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
    else if (ts.isTemplateExpression(node)) text = node.getText(sf);
    if (text !== null && /\bSomeone\b/.test(text)) {
      const p = node.parent;
      const fallback =
        text === "Someone" &&
        ((ts.isCallExpression(p) && p.arguments.includes(node as ts.Expression) &&
          /^(memberDisplayName|memberDisplayNameOf)$/.test(p.expression.getText(sf).split(".").pop() ?? "")) ||
          (ts.isBinaryExpression(p) && p.right === node &&
            [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(p.operatorToken.kind)));
      if (!fallback) out.push(text);
      if (ts.isTemplateExpression(node)) return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function edgeFile(key: string): string {
  const a = join(ROOT, "supabase", "functions", `${key}.ts`);
  return existsSync(a) ? a : join(ROOT, "supabase", "functions", key, "index.ts");
}

/** src/ files (not tests) that insert into notifications. */
function clientWriters(): string[] {
  return walkSource([join(ROOT, "src")])
    .map((f) => relative(ROOT, f).replace(/\\/g, "/"))
    .filter((f) => !/(^|\/)test\/|\.test\.tsx?$|\.spec\.tsx?$/.test(f))
    .filter((f) => /\.from\(\s*["'`]notifications["'`]\s*\)[\s\S]{0,400}?\.insert\s*\(/.test(blankComments(readFileSync(join(ROOT, f), "utf8"))))
    .sort();
}

const sqlInv = sqlInventory();
const tsInv = [
  ...edgeProducers(ROOT).map((k) => relative(ROOT, edgeFile(k)).replace(/\\/g, "/")),
  "supabase/functions/_shared/notification-templates.ts",
  ...clientWriters(),
].sort();
const sqlBad = (name: string) => sqlSomeoneOffences(defs.get(name)!.stmt);
const tsBad = (file: string) => tsSomeoneOffences(readFileSync(join(ROOT, file), "utf8"));

describe("a notification with a known actor names them, never 'Someone' (owner 2026-10-21)", () => {
  it("reads the inventories", () => {
    expect(producers.length).toBeGreaterThan(40);
    expect(sqlInv.length).toBeGreaterThan(producers.length);
    expect(sqlInv).toContain("declutter_wanted_record_match");
    expect(tsInv.length).toBeGreaterThan(30);
    expect(tsInv).toContain("supabase/functions/_shared/heldTipRepay.ts");
    expect(tsInv.some((f) => f.startsWith("src/"))).toBe(true);
  });

  it("the SQL checker tells a fallback from a 'Someone' sentence", () => {
    expect(sqlSomeoneOffences(`SELECT public.member_display_name(p.full_name, 'Someone') INTO v`)).toEqual([]);
    expect(sqlSomeoneOffences(`v := COALESCE(v_name, 'Someone') || ' applied';`)).toEqual([]);
    expect(sqlSomeoneOffences(`v := 'Someone applied to "' || t || '"';`)).toEqual([`'Someone applied to "'`]);
    expect(sqlSomeoneOffences(`v := 'Someone' || ' applied';`)).toEqual(["'Someone'"]);
    expect(sqlSomeoneOffences(`-- 'Someone applied'\nv := 1;`)).toEqual([]);
  });

  it("the TypeScript checker tells a fallback from a 'Someone' sentence", () => {
    expect(tsSomeoneOffences(`const n = memberDisplayName(x, "Someone");`)).toEqual([]);
    expect(tsSomeoneOffences(`const n = await memberDisplayNameOf(db, id, reader, "Someone");`)).toEqual([]);
    expect(tsSomeoneOffences(`const n = name || "Someone";`)).toEqual([]);
    expect(tsSomeoneOffences("const m = `Someone tipped you ${x}`;")).toHaveLength(1);
    expect(tsSomeoneOffences(`const m = "Someone applied";`)).toEqual(["Someone applied"]);
    expect(tsSomeoneOffences(`const n = "Someone"; // fallback`)).toEqual(["Someone"]);
  });

  it("no SQL producer (or function feeding one) writes 'Someone' for a known person", () => {
    const bad = sqlInv.filter((n) => !(n in SQL_SOMEONE_OK)).flatMap((n) => sqlBad(n).map((l) => `${n}: ${l}`));
    expect(bad).toEqual([]);
  });

  it("no edge or client producer writes 'Someone' for a known person", () => {
    const bad = tsInv.filter((f) => !(f in TS_SOMEONE_OK)).flatMap((f) => tsBad(f).map((l) => `${f}: ${l}`));
    expect(bad).toEqual([]);
  });

  it("every exception is still in the inventory and still writes 'Someone' (two-way)", () => {
    for (const n of Object.keys(SQL_SOMEONE_OK)) {
      expect(sqlInv, n).toContain(n);
      expect(sqlBad(n).length, n).toBeGreaterThan(0);
    }
    for (const f of Object.keys(TS_SOMEONE_OK)) {
      expect(tsInv, f).toContain(f);
      expect(tsBad(f).length, f).toBeGreaterThan(0);
    }
  });

  it("the review exception is the held branch only: the revealed branch names the reviewer", () => {
    const body = blankSqlComments(defs.get("notify_user_on_review")!.stmt);
    expect(sqlSomeoneOffences(body)).toEqual([`'Someone reviewed you for "'`]);
    expect(body).toMatch(/v_title := 'New review from ' \|\| v_reviewer_name;/);
  });

  it("memberDisplayNameOf: 'First L.', a deleted member, a block, a blank name, a failed read, no id", async () => {
    const db = (res: unknown, throws = false, blocks: unknown = { data: [], error: null }) => ({
      from: (t: string) =>
        t === "user_blocks"
          ? { select: () => ({ or: () => ({ limit: async () => blocks }) }) }
          : { select: () => ({ eq: () => ({ maybeSingle: async () => { if (throws) throw new Error("net"); return res; } }) }) },
    });
    const quiet = console.warn;
    console.warn = () => {};
    try {
      const bea = { data: { full_name: "Bea Jean Thibodeaux" }, error: null };
      expect(await memberDisplayNameOf(db(bea), "u", "r", "Someone")).toBe("Bea T.");
      expect(await memberDisplayNameOf(db(bea, false, { data: [{ blocker_id: "r" }], error: null }), "u", "r", "Someone")).toBe("Someone");
      expect(await memberDisplayNameOf(db(bea, false, { data: null, error: { message: "x" } }), "u", "r", "Someone")).toBe("Someone");
      expect(await memberDisplayNameOf(db({ data: null, error: null }), "u", "r", "Someone")).toBe("A former member");
      expect(await memberDisplayNameOf(db({ data: { full_name: "  " }, error: null }), "u", "r", "Someone")).toBe("Someone");
      expect(await memberDisplayNameOf(db({ data: null, error: { message: "x" } }), "u", "r", "Someone")).toBe("Someone");
      expect(await memberDisplayNameOf(db(null, true), "u", "r", "Someone")).toBe("Someone");
      expect(await memberDisplayNameOf(db(bea), null, "r", "Someone")).toBe("Someone");
    } finally {
      console.warn = quiet;
    }
  });

  it("the application notice names the applicant through member_display_name, not across a block", () => {
    const body = blankSqlComments(defs.get("notify_on_application")!.stmt);
    expect(body).toMatch(/public\.member_display_name\(p\.full_name, 'Someone'\) INTO v_applicant/);
    expect(body).toMatch(/IF NOT COALESCE\(public\.are_users_blocked\(NEW\.helper_id, job_owner\), true\) THEN/);
  });
});
