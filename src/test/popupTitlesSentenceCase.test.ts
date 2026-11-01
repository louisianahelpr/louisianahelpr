/**
 * Every pop-up hero title (`<DialogHero title=…>`) is SENTENCE CASE: the first
 * word starts with a capital, and every later word is lower case unless it is a
 * proper noun or an acronym (HELPR-DESIGN-SPEC v2 §2, "Sentence case
 * everywhere"; lead 2026-10-21, TRAIN29). It replaces popupTitlesTitleCase,
 * which enforced the older Title Case rule ("Before photos" -> "Before Photos",
 * owner 2026-10-08) that the binding spec has since overturned.
 *
 * Literal strings and the literal words of template strings are read; a `${…}`
 * part is a value (a member's name, a job title, a count) and is skipped. A
 * word after ". ? ! :" starts a new sentence ("Loved it? Share Helpr").
 *
 * @mutate src/components/profile/AvatarCropDialog.tsx | "Position your photo" | "Position Your Photo"
 * @mutate src/components/PhotoProof.tsx | "After"} photos`} | "After"} Photos`}
 * @mutate src/components/messages/ChatView.tsx | title="Edit message" | title="Edit Message"
 * @mutate src/components/profile/EarningsTab.tsx | "Unlock instant cash out" | "Unlock Instant Cash out"
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { en } from "@/lib/i18n/en";

/**
 * Every popup or sheet TITLE primitive (lead 2026-10-21: DialogHero, then
 * BrandConfirmDialog, SheetHero, WhatNextSheet, SignOutConfirmDialog and the
 * sheets that take a `title`). Exact: a new primitive with a title prop is
 * added here, and the inventory count below moves with it.
 */
const PRIMITIVES = ["DialogHero", "SheetHero", "BrandConfirmDialog", "WhatNextSheet", "SignOutConfirmDialog", "FilterSheet", "ChoiceSheet", "ProUpgradeSheet"];

const files = execFileSync("git", ["grep", "-lE", `<(${PRIMITIVES.join("|")})`, "--", "src"], { encoding: "utf8" })
  .split("\n").filter((f) => f && /\.tsx$/.test(f) && !/\.test\./.test(f));

/** The opening tag's attribute text, braces balanced (JSX values hold `>`). */
function openingTags(src: string): { tag: string; attrs: string }[] {
  const out: { tag: string; attrs: string }[] = [];
  for (const m of src.matchAll(new RegExp(`<(${PRIMITIVES.join("|")})\\b`, "g"))) {
    let depth = 0;
    let i = m.index! + m[0].length;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    out.push({ tag: m[1], attrs: src.slice(m.index! + m[0].length, i) });
  }
  return out;
}

/** The value text of `title=` inside one opening tag: "x", {"x"}, {`x`} or {expr}. */
function titleValue(attrs: string): string | null {
  const m = /(?<![\w-])title=/.exec(attrs);
  if (!m) return null;
  let i = m.index + m[0].length;
  if (attrs[i] === '"') return attrs.slice(i, attrs.indexOf('"', i + 1) + 1);
  if (attrs[i] !== "{") return null;
  let depth = 0;
  const start = i;
  for (; i < attrs.length; i++) {
    if (attrs[i] === "{") depth++;
    else if (attrs[i] === "}" && --depth === 0) break;
  }
  return attrs.slice(start, i + 1);
}

/**
 * The words a title SHOWS: a plain literal, a template's literal parts, and in
 * an expression the string BRANCHES (after ? : ?? || &&), never the strings it
 * compares against (`step === "confirmation"`). `${…}` becomes a value marker.
 */
function titles(src: string): string[] {
  const out: string[] = [];
  for (const { attrs } of openingTags(src)) {
    const raw0 = titleValue(attrs);
    if (!raw0) continue;
    // A title from the dictionary (Spanish option, 2026-10-29) is judged by its English words.
    const v = raw0.replace(/\b(?:t|tr)\(\s*"([\w.]+)"[^)]*\)/g, (m, k: string) => (k in en ? JSON.stringify(en[k as keyof typeof en]) : m));
    const lit = /^"([^"]*)"$/.exec(v) ?? /^\{"([^"]*)"\}$/.exec(v) ?? /^\{`([^`]*)`\}$/.exec(v);
    const parts = lit
      ? [lit[1]]
      : [...v.matchAll(/(?:\?|:|\?\?|\|\||&&)\s*(?:"([^"]*)"|`([^`]*)`)/g)].map((x) => x[1] ?? x[2]);
    for (const raw of parts) out.push(raw.replace(/\$\{[^}]*\}/g, "\u0001"));
  }
  return out;
}

/** Proper nouns a title may capitalise mid-sentence. */
const PROPER = new Set(["Helpr", "Louisiana", "Stripe", "Apple", "Google", "Pay", "ID"]);
/** An acronym or code: two or more capitals/digits, hyphens allowed (W-9, 2FA, SMS). */
const ACRONYM = /^[A-Z0-9][A-Z0-9-]*[A-Z0-9]$/;

/** The words that break the rule, empty when the title is sentence case. */
function sentenceCaseProblems(title: string): string[] {
  const bad: string[] = [];
  let start = true;
  for (const token of title.split(/\s+/).filter(Boolean)) {
    const word = token.replace(/^["'“(]+/, "").replace(/["'”).,?!:;]+$/, "");
    if (word.includes("\u0001") || !/^[A-Za-z]/.test(word)) {
      start = false;
    } else if (start) {
      if (!/^[A-Z]/.test(word)) bad.push(word);
      start = false;
    } else if (/^[A-Z]/.test(word) && !PROPER.has(word) && !ACRONYM.test(word)) {
      bad.push(word);
    }
    if (/[.?!:]["'”)]*$/.test(token)) start = true;
  }
  return bad;
}

describe("every pop-up title is sentence case", () => {
  const all = files.flatMap((f) => titles(blankComments(readFileSync(f, "utf8"))).map((t) => ({ f, t })));

  it("reads every real title (exact inventory, both ways)", () => {
    // 162 on 2026-10-21 (builder1g): every title on DialogHero, SheetHero,
    // BrandConfirmDialog, WhatNextSheet, SignOutConfirmDialog, FilterSheet,
    // ChoiceSheet and ProUpgradeSheet (58 when only DialogHero was read). A new
    // title raises it, a deleted one lowers it, in the same commit. 169 on the
    // combined tree: +7 titles from the trains merged after builder1g's base
    // (measured by this test on the rebased TRAIN34). 173 with Builder 5's
    // boards 156/120/142 (2026-10-21): the dispute timeline's one "Timeline"
    // title became four states (Under review, Decision, Withdrawn, Dispute on
    // a failed load), and the delete dialog's and SOS sheet's titles changed
    // in place. 174 on TRAIN A (2026-10-21, measured by this test on the combined
    // tree): +1 board 91 (Save this search). 175: +1 the Stripe Identity sheet
    // (2026-10-21, IdentityCheckSheet: "Verify your ID" and its states). 174:
    // -1 Q1680 (owner 2026-10-21): our W-9 form (W9CollectionDialog) is removed.
    // 175: +1 the Declutter rework (board 117's "I have this" reply sheet).
    // 177: +2 board 141 refund requests (2026-10-21, measured by this test on
    // the rebased tree): RefundRequestDialog and RefundAnswerDialog.
    // 178: + "Approve for the poster?" (the approval queue's confirm, 2026-10-23).
    // 179: + "You have the item back?" (the refund request's one confirm, money review 2026-10-27).
    // 181: +2 Declutter's Buy now sheet (2026-10-28, DeclutterReserveSheet): "Reserve it for 48 hours", "Reserved for you".
    // 180: -1 the refund's "You have the item back?" left BrandConfirmDialog for Declutter's ConfirmSheet (deep audit
    // 2026-10-28 #59), whose title is a prop this reader does not see.
    // 181: + "Agree the handover" (the Declutter handover chat, #3730, DeclutterHandoverTalk).
    // 182: + "Edit listing" (Declutter Manage listing, audit 1028 D1-1, Q2475).
    // 184: +2 the paid-order chat (audit 1028 D2-1, DeclutterOrderTalk): "Message the ${other}" and "Order chat" while it loads.
    // 186: +2 batch 1030e: "Take this listing down?" (the admin's report take-down, B77 DeclutterTakeDown) and
    // "What are you looking for?" (the Wanted hub's quick post sheet, B82 DeclutterWantedViews).
    // 184: -2 DB-5 (owner 2026-10-30: Buy now goes straight to checkout): the Buy now sheet and its two titles are gone.
    // 186: +2 batch 1030 (2026-10-30): "Edit your post" (Wanted) and "How a Helpr helps you list" (B42).
    // 188: +2 the posting stack: "Your free listing is live" (ListedWhatNext) and "${itemName}, photo ${position}" (DeclutterBunchPhotos).
    // 191: +1 BUY-5 "Picked up?" (PickedUpPhotoSheet, the buyer's porch pickup photo preview).
    // 190: +2 batch 3: "Take this post down?" (WantedReportPanel) and "Is it still available?" (DeclutterStillAvailable).
    // 195: +1 JobConfirmation's "Commit to this job?" is now two by role, "Confirm the job is still on" / "Confirm you'll be there" (d86a0f910e).
    // 194: +1 "You're all set" (SmsPhonePrompt, the phone prompt closes itself once texts are on, 8372dffb4d).
    // 193: +2 train l50 (2026-10-31): "Cash out didn't finish" (InstantPayoutDialog's failed cash-out screen) and
    // "Decline ${dollars(priceCents)}?" (QuoteAnswerControls, Decline asks before it ends a quote).
    // 196: +1 the order chat after the order closes: "Your chat with the ${other}" (DeclutterOrderTalk, b3 train #3892).
    // 197: +1 "Continue where you left off" (DeclutterSellChooser's one Continue row opens a sheet of the kept choices, 2ef8b89f23).
    // 198: +1 "A one-time ID check" (IdentityCheckSheet's DialogHero, B49 train 5, behind identity_check).
    // 199: +1 "Message about this delivery" (the delivery chat, BUY-36, DeliveryTalk).
    // 200: +1 the guest job preview's DialogHero, its title the job's own title or "Job" (b46 GuestJobPreview, train 8).
    expect(all.length).toBe(200);
  });

  it("the rule itself: catches Title Case and a lower-case start, allows names and acronyms", () => {
    expect(sentenceCaseProblems("Position Your Photo")).toEqual(["Your", "Photo"]);
    expect(sentenceCaseProblems("delete this note?")).toEqual(["delete"]);
    expect(sentenceCaseProblems("Loved it? Share Helpr")).toEqual([]);
    expect(sentenceCaseProblems("Sign your W-9")).toEqual([]);
    expect(sentenceCaseProblems("Happy birthday, \u0001")).toEqual([]);
  });

  it("no title breaks sentence case", () => {
    const bad = all
      .map(({ f, t }) => ({ f, t, words: sentenceCaseProblems(t) }))
      .filter((x) => x.words.length > 0)
      .map(({ f, t, words }) => `${f}: "${t.split("\u0001").join("${…}").trim()}" (${words.join(", ")})`);
    expect(bad).toEqual([]);
  });
});
