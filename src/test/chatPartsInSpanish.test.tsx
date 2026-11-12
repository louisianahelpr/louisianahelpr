/**
 * F260q: Messages' remaining chat pieces follow the member's language: the quick-reply chips and the words they drop
 * into the composer or send (QuickReplies, msg.qr.*; the ETA's time in es-US), the chat's job card (DealCard: the
 * approval clock, the parish, its buttons and label, msg.dc.*), the application note's label and the reply preview's
 * "Attachment". Still English: the DealCard's screen-reader "Your pay" (shared with the job page and the take-home
 * row; giveawayShowsNoWords holds it word for word).
 *
 * @mutate src/components/QuickReplies.tsx |           {t(qr.label)}\n |           {qr.label}\n
 * @mutate src/components/QuickReplies.tsx |     onSelect(t(qr.message)); |     onSelect(qr.message);
 * @mutate src/components/QuickReplies.tsx |           {t("msg.qr.enRoute")} |           I'm en route
 * @mutate src/components/QuickReplies.tsx | toLocaleTimeString(getLang() === "es" ? "es-US" : "en-US", { | toLocaleTimeString("en-US", {
 * @mutate src/components/messages/chatView/DealCard.tsx |           {approveDue ? t("msg.dc.approve") : t("msg.dc.openJob")} |           {approveDue ? "Approve" : "Open job"}
 * @mutate src/components/messages/chatView/DealCard.tsx |   if (mins <= 0) return t("msg.dc.timesUp"); |   if (mins <= 0) return "time's up, Helpr support steps in";
 * @mutate src/components/messages/chatView/ApplicationNoteCard.tsx |       aria-label={t("msg.dc.theirApplication")} |       aria-label="Their application"
 * @mutate src/components/messages/chatView/ChatComposer.tsx | {replyTo.content?.trim() \|\| t("msg.dc.attachment")} | {replyTo.content?.trim() \|\| "Attachment"}
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { es } from "@/lib/i18n/es";
import { enMessages } from "@/lib/i18n/enMessages";
import { esMessages } from "@/lib/i18n/esMessages";
import { QuickReplies } from "@/components/QuickReplies";
import { blankComments } from "@/test/helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const src = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));

describe("F260q: Messages' chat pieces follow the member's language", () => {
  afterEach(() => { cleanup(); __resetLangForTests(); });

  it("every chat-piece word has its Spanish with the same slots, and es.ts carries it", () => {
    const keys = (Object.keys(enMessages) as (keyof typeof enMessages)[]).filter((k) => /^msg\.(qr|dc)\./.test(k));
    expect(keys.length).toBeGreaterThan(30);
    for (const k of keys) {
      expect(es[k], k).toBe(esMessages[k]);
      if (k !== "msg.qr.min") expect(esMessages[k], `${k} still English`).not.toBe(enMessages[k]);
      expect([...esMessages[k].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort(), k).toEqual([...enMessages[k].matchAll(/\{\w+\}/g)].map((m) => m[0]).sort());
    }
  });

  it("English: the chips and their words as before", () => {
    const onSelect = vi.fn();
    render(<QuickReplies audience="poster" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /When can you start\?/ }));
    expect(onSelect).toHaveBeenCalledWith("Hi — when's the earliest you could start? Trying to plan around it.");
    cleanup();
    render(<QuickReplies audience="helper" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /I'm en route/ }));
    fireEvent.click(screen.getByRole("button", { name: "10 min" }));
    expect(onSelect).toHaveBeenLastCalledWith(expect.stringMatching(/^🚗 I'm en route — ETA about 10 minutes \(around \d{1,2}:\d{2} [AP]M\)\. See you soon!$/));
  });

  it("Spanish: the chips, what they drop in, and the ETA's time", async () => {
    setLang("es");
    await ensureLangLoaded();
    const onSelect = vi.fn();
    render(<QuickReplies audience="poster" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /¿Cuándo puede empezar\?/ }));
    expect(onSelect).toHaveBeenCalledWith("Hola, ¿cuándo es lo más pronto que podría empezar? Quiero planear con eso.");
    cleanup();
    render(<QuickReplies audience="helper" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /^Voy en camino$/ }));
    fireEvent.click(screen.getByRole("button", { name: "10 min" }));
    expect(onSelect).toHaveBeenLastCalledWith(expect.stringMatching(/^🚗 Voy en camino: llego en unos 10 minutos \(cerca de las .*[ap]\.\s?m\.\)\. ¡Nos vemos!$/));
  });

  it("the job card, the note and the reply preview read their words from the dictionary", () => {
    expect(src("src/components/messages/chatView/DealCard.tsx")).toContain('{approveDue ? t("msg.dc.approve") : t("msg.dc.openJob")}');
    expect(src("src/components/messages/chatView/DealCard.tsx")).toContain('if (mins <= 0) return t("msg.dc.timesUp");');
    expect(src("src/components/messages/chatView/ApplicationNoteCard.tsx")).toContain('aria-label={t("msg.dc.theirApplication")}');
    expect(src("src/components/messages/chatView/ChatComposer.tsx")).toContain('t("msg.dc.attachment")');
  });
});
