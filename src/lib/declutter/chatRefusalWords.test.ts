/**
 * NOID-20 (Declutter chat safety filter, 11-03): the three Declutter chats' triggers (handover, order, Helpr delivery;
 * 20261030144615, 20261103203202) refuse objectionable words with check_violation "That message breaks our community
 * rules. Please reword it.", and contact details with "<what> in the message. Keep contact details and payment out of
 * the chat...". Every chat shows declutterErrorMessage(err), so both sentences must reach the member as written,
 * never the listing-form fallback ("Check the details: the title needs 3 to 80 characters...").
 * @mutate src/lib/declutter/errors.ts | && /Keep contact details and payment (off the listing\|out)\|breaks our community rules/.test(message)) return message; | && /Keep contact details and payment (off the listing\|out)/.test(message)) return message;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { declutterErrorMessage } from "./errors";

const RULES = "That message breaks our community rules. Please reword it.";

describe("a Declutter chat's refusal reaches the member in its own words", () => {
  it("objectionable words: the community-rules sentence, as the trigger wrote it", () => {
    expect(declutterErrorMessage({ code: "23514", message: RULES })).toBe(RULES);
  });

  it("contact details: the trigger's sentence, as before", () => {
    const m = "Phone number detected in the message. Keep contact details and payment out of the chat.";
    expect(declutterErrorMessage({ code: "23514", message: m })).toBe(m);
  });

  it("every Declutter chat trigger still raises the community-rules sentence (inventory floor)", () => {
    const n = ["20261030144615_message_admin_reads_reports_deletes.sql", "20261103203202_helpr_delivery_talk_refuses_objectionable.sql"]
      .map((f) => readFileSync(`supabase/migrations/${f}`, "utf8").split(RULES).length - 1)
      .reduce((a, b) => a + b, 0);
    expect(n).toBeGreaterThan(2);
  });
});
