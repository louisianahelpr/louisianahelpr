/**
 * Q2471 (4) (owner 2026-10-29): "How does this work?" on the money screen, answered from our Help Center only
 * (support-ai-answer "ask" mode). The answer shows with the AI note; no answer points to Support; the money tab
 * mounts it.
 *
 * @mutate src/components/money/MoneyHelp.tsx |         setAnswer(await askSupportAi(MONEY_HELP_SUBJECT, question.trim())); |         setAnswer(null);
 * @mutate src/components/money/MoneyHelp.tsx |       {answer === null && ( |       {answer === "never" && (
 * @mutate src/pages/profile/ProfileTabPanels.tsx |           <div className="mt-4"><MoneyHelp /></div> |
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";

const askSupportAi = vi.fn();
vi.mock("@/pages/info/SupportAi", () => ({ askSupportAi: (s: string, m: string) => askSupportAi(s, m) }));
import { MONEY_HELP_SUBJECT, MoneyHelp } from "@/components/money/MoneyHelp";

function ask(question: string) {
  render(<MemoryRouter><MoneyHelp /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "How does this work?" }));
  fireEvent.change(screen.getByLabelText(/Ask how payments/), { target: { value: question } });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
}

describe("MoneyHelp", () => {
  it("shows the Help Center answer with the AI note, asking about money", async () => {
    askSupportAi.mockResolvedValueOnce("You're paid after the poster marks the job done.");
    ask("When do I get paid after a job?");
    expect(await screen.findByText("You're paid after the poster marks the job done.")).toBeTruthy();
    expect(screen.getByText(/Written by our AI assistant from our Help Center/)).toBeTruthy();
    expect(askSupportAi).toHaveBeenCalledWith(MONEY_HELP_SUBJECT, "When do I get paid after a job?");
  });
  it("no answer points to Support", async () => {
    askSupportAi.mockResolvedValueOnce(null);
    ask("Something the Help Center does not cover");
    expect(await screen.findByText(/We couldn.t find that in our Help Center/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ask our team" }).getAttribute("href")).toBe("/support");
  });
  it("a too-short question cannot be sent", () => {
    render(<MemoryRouter><MoneyHelp /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "How does this work?" }));
    fireEvent.change(screen.getByLabelText(/Ask how payments/), { target: { value: "fees?" } });
    expect((screen.getByRole("button", { name: "Ask" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("the money tab mounts it", () => {
    const src = blankComments(readFileSync(join(__dirname, "..", "pages", "profile", "ProfileTabPanels.tsx"), "utf8"));
    const money = src.slice(src.indexOf('(tab === "earnings" || tab === "payment") && user && ('), src.indexOf('tab === "schedule" && !user'));
    expect(money.length).toBeGreaterThan(200);
    expect(money).toContain("<MoneyHelp />");
  });
});
