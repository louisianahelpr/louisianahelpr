/**
 * Q998 — A REFUSED MESSAGE SAYS WHY.
 *
 * THE DEFECT. public.enforce_message_rate refuses a sender's 31st message in a
 * rolling hour with "You are sending messages too quickly. Please slow down."
 * The composer dropped that text: the send fell into the generic branch of
 * sendHandlers ("Message didn't go through — tap it to try again", a "Not Sent
 * — Tap to Retry" bubble), and an immediate retry hit the same limit. The block,
 * ban and unconfirmed-email triggers had the same shape, worse: a retry there
 * can never work.
 *
 * THE CLASS. Every BEFORE/AFTER INSERT trigger the migrations leave on
 * public.messages whose function RAISEs an exception is a refusal the composer
 * can meet. Inventory: triggerInventory() + effectiveDefs() over the
 * migrations (newest definition, any dollar tag, comments blanked). Each
 * raised text must be classified by src/lib/messageSendRefusal.ts, or listed in
 * NOT_FROM_THE_COMPOSER with the reason the composer cannot trip it. Two-way:
 * a listed entry that is classified, or no longer raised, fails too.
 */
// @mutate src/lib/messageSendRefusal.ts |   { kind: "rate_limited", match: (m) => RATE_LIMIT_RAISE.test(m), retryable: true, toast: RATE_LIMITED_TOAST }, |
// @mutate src/pages/messages/messagesData/sendHandlers.ts |       if (refusal) { |       if (false) {
// @mutate src/components/messages/MessageBubble.tsx | {m.failReason ? REFUSAL_BUBBLE_LABEL[m.failReason] : "Not Sent — Tap to Retry"} | Not Sent — Tap to Retry
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { bodyOf, firstRaise, triggerInventory, triggersOn } from "./helpers/migrationTriggers";
import { REFUSAL_BUBBLE_LABEL, classifySendRefusal } from "@/lib/messageSendRefusal";

const ROOT = resolve(__dirname, "../..");
const MIG = join(ROOT, "supabase", "migrations");

/** Raised texts a person's own send from the composer cannot reach, and why. */
const NOT_FROM_THE_COMPOSER: Record<string, string> = {
  // messages_validate_reply: the composer only offers "reply" on a message in
  // the open thread, which is that job's thread.
  "messages: reply_to_id % is not in job %": "reply_to_id is always a message of the open thread",
};

function raisingInsertTriggers() {
  const files = migrationFiles(MIG).map((name) => ({ name, sql: readFileSync(join(MIG, name), "utf8") }));
  const defs = effectiveDefs(MIG);
  const out: { trigger: string; fn: string; raises: string[] }[] = [];
  for (const t of triggersOn(triggerInventory(files), "messages")) {
    if (!/\bINSERT\b/.test(t.events)) continue;
    const def = defs.get(t.fn);
    if (!def) continue;
    const body = bodyOf(def.stmt);
    if (firstRaise(body) < 0) continue;
    const raises = [
      ...body.matchAll(/\bRAISE\s+(?:EXCEPTION\s+)?'((?:[^']|'')*)'/gi),
    ]
      .filter((m) => !/\bRAISE\s+(?:WARNING|NOTICE|LOG|INFO|DEBUG)\b/i.test(m[0]))
      .map((m) => m[1].replace(/''/g, "'"));
    out.push({ trigger: t.name, fn: t.fn, raises });
  }
  return out;
}

describe("every refusal a messages INSERT trigger raises is classified for the composer (Q998)", () => {
  const inv = raisingInsertTriggers();
  const raised = inv.flatMap((t) => t.raises.map((text) => ({ ...t, text })));

  it("the inventory is real (the raising INSERT triggers on messages, read from the migrations)", () => {
    expect(inv.map((t) => t.fn)).toEqual(expect.arrayContaining(["enforce_message_rate", "enforce_block_on_message_insert"]));
    expect(raised.length).toBeGreaterThan(3);
  });

  it("each raised text is classified, or listed as unreachable from the composer", () => {
    const unhandled = raised
      .filter((r) => classifySendRefusal({ message: r.text }) === null && !(r.text in NOT_FROM_THE_COMPOSER))
      .map((r) => `${r.fn}: ${r.text}`);
    expect(unhandled).toEqual([]);
  });

  it("the unreachable list is exact: every entry is still raised and not classified", () => {
    const texts = new Set(raised.map((r) => r.text));
    for (const text of Object.keys(NOT_FROM_THE_COMPOSER)) {
      expect(texts.has(text), text).toBe(true);
      expect(classifySendRefusal({ message: text }), text).toBeNull();
    }
  });

  it("the send limit keeps a retry and names the limit; the others refuse for good", () => {
    const rate = raised.find((r) => r.fn === "enforce_message_rate");
    expect(rate).toBeDefined();
    const c = classifySendRefusal({ code: "P0001", message: rate!.text });
    expect(c?.kind).toBe("rate_limited");
    expect(c?.retryable).toBe(true);
    expect(c?.toast).toMatch(/hourly message limit/i);
    expect(REFUSAL_BUBBLE_LABEL.rate_limited).toMatch(/Hourly Limit/);
    for (const r of raised) {
      const k = classifySendRefusal({ message: r.text });
      if (k && k.kind !== "rate_limited") expect(k.retryable, r.text).toBe(false);
    }
  });

  it("an unexplained failure still gets the generic retry (no false classification)", () => {
    expect(classifySendRefusal({ code: "08006", message: "Failed to fetch" })).toBeNull();
    expect(classifySendRefusal(null)).toBeNull();
  });

  it("the composer's send path and the bubble use the classification", () => {
    const send = blankComments(readFileSync(join(ROOT, "src/pages/messages/messagesData/sendHandlers.ts"), "utf8"));
    const at = send.indexOf("classifySendRefusal(");
    const generic = send.indexOf("Message didn't go through");
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(generic);
    expect(send).toMatch(/if \(refusal\) \{[\s\S]{0,200}toast\.error\(refusal\.toast\)/);
    const bubble = blankComments(readFileSync(join(ROOT, "src/components/messages/MessageBubble.tsx"), "utf8"));
    expect(bubble.match(/REFUSAL_BUBBLE_LABEL\[m\.failReason\]/g)?.length).toBe(2);
  });
});
