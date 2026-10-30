/**
 * THE CHAT SCREENS' EVERYDAY WORDS COME FROM THE DICTIONARY (list #22, Messages audit M5: "Chat screens English only").
 * A Spanish member gets the chat's controls, empty states and everyday errors in Spanish. Safety, rules and money wording
 * stays English on purpose until a person translates it (lead 10-30): the ViolationDialog and the safety reminder are not
 * here. The words are gone from the files below, so a new hard-coded control name fails here.
 *
 * @mutate src/components/RichMessageInput.tsx | aria-label={t("chat.send")} | aria-label="Send message"
 * @mutate src/components/messages/MessageActionSheet.tsx | label={t("chat.reply")} | label="Reply"
 * @mutate src/lib/i18n/es.ts |   "chat.reply": "Responder", |   "chat.reply": "Reply",
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";

const ROOT = resolve(__dirname, "../..");
const CHAT_FILES = [
  "src/components/messages/ChatHeader.tsx",
  "src/components/messages/chatView/ChatComposer.tsx",
  "src/components/messages/MessageActionSheet.tsx",
  "src/components/messages/MuteSheet.tsx",
  "src/components/messages/HiddenUnreadBar.tsx",
  "src/components/messages/InboxMenus.tsx",
  "src/components/RichMessageInput.tsx",
  "src/components/messages/MessageBubble.tsx",
];
const chatKeys = (Object.keys(en) as (keyof typeof en)[]).filter((k) => k.startsWith("chat."));

describe("chat screens read the dictionary (#22)", () => {
  it.each(CHAT_FILES)("%s has no hard-coded control name", (file) => {
    const src = blankComments(readFileSync(resolve(ROOT, file), "utf8"));
    expect(src).toContain('t("chat.');
    const literal = [...src.matchAll(/\b(?:aria-label|placeholder|label)="[A-Z][^"]*"/g)].map((m) => m[0]);
    expect(literal).toEqual([]);
  });

  it("every chat word really has its own Spanish", () => {
    expect(chatKeys.length).toBeGreaterThan(30);
    const same = chatKeys.filter((k) => es[k] === en[k]);
    expect(same).toEqual([]);
  });
});
