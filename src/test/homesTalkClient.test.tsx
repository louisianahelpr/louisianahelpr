/**
 * Homes messages, client slice (audit 11-05 A-H1, docs/NOT-LAUNCHED.md Q2209; server 20261106182837_homes_talk, report
 * + export 20261106191100). A member messages a listing's owner from the listing page; either side reads the thread
 * over the page (?talk=) or from Messages -> Homes; the other side's message can be reported (home_talk_message) and
 * the admin queue shows its kept copy, never a person; a for-sale thread and page carry the wire-fraud line (D-M1).
 * Server behaviour is src/test/pglite/homesTalk.pglite.mjs and homesTalkReportExport.pglite.mjs.
 *
 * @mutate src/components/rentals/listings/HomeTalk.tsx | {t.listing_kind === "sale" && ( | {false && (
 * @mutate src/components/rentals/listings/HomeTalk.tsx |                     {!m.mine && ( |                     {true && (
 * @mutate src/components/rentals/listings/ListingView.tsx | {!l.is_mine && <HomeMessageButton listingId={l.id} />} | <HomeMessageButton listingId={l.id} />
 * @mutate src/pages/messages/useMessageSections.tsx | if (section === "homes" && live.homes) empty.Lead = HomeTalkLead; | if (false) empty.Lead = HomeTalkLead;
 * @mutate src/lib/rentals/talk.ts |   if (LEAK_SENTENCE.test(msg)) return msg; |   if (false) return msg;
 * @mutate src/components/admin/adminReports/ReportedCopy.tsx | const removable = report.reported_type.startsWith("declutter_") \|\| isShopReview; | const removable = report.reported_type !== "message";
 * @mutate src/components/admin/adminReports/fetchReports.ts | && r.reported_type !== HOME_TALK_MESSAGE_REPORT; | ;
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const TALK = "22222222-2222-4222-8222-222222222222";
const talkMocks = vi.hoisted(() => ({ fetchHomeTalk: vi.fn(), markHomeTalkRead: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/rentals/talk", async (orig) => ({
  ...(await orig<typeof import("@/lib/rentals/talk")>()),
  fetchHomeTalk: talkMocks.fetchHomeTalk,
  markHomeTalkRead: talkMocks.markHomeTalkRead,
}));

import { HomeTalkFromLink } from "@/components/rentals/listings/HomeTalk";
import { HOME_TALK_ERROR_COPY, homeTalkErrorMessage, WIRE_FRAUD_LINE } from "@/lib/rentals/talk";
import { RENTALS_ERROR_COPY } from "@/lib/rentals/errorCopy";
import { REASONS, REPORTED_NOUN, REASON_PROMPT } from "@/components/reportDialog/reportReasons";
import { ReportedCopy } from "@/components/admin/adminReports/ReportedCopy";

const ROOT = resolve(__dirname, "../..");
const src = (f: string) => blankComments(readFileSync(resolve(ROOT, f), "utf8")).replace(/\s+/g, " ");
const TALK_SQL = blankSqlComments(readFileSync(resolve(ROOT, "supabase/migrations/20261106182837_homes_talk.sql"), "utf8"));

const view = (kind: "rent" | "sale") => ({
  talk_id: TALK, listing_id: "l1", listing_headline: "Two-bed shotgun near the park", listing_kind: kind,
  side: "member", other_label: "Ruth", open: true,
  messages: [
    { id: "m1", mine: true, body: "Is it still free?", created_at: "2026-11-06T20:00:00Z" },
    { id: "m2", mine: false, body: "Yes, come Saturday.", created_at: "2026-11-06T20:05:00Z" },
  ],
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/rentals/listings/l1?talk=${TALK}`]}>
        <HomeTalkFromLink />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Homes messages, client (Q2209)", () => {
  beforeEach(() => {
    talkMocks.fetchHomeTalk.mockReset();
    talkMocks.markHomeTalkRead.mockReset();
    talkMocks.markHomeTalkRead.mockResolvedValue(undefined);
  });

  it("every code the talk migration raises has words, and every line is a code it raises (exact)", () => {
    const codes = new Set([...TALK_SQL.matchAll(/RAISE\s+EXCEPTION\s+'([a-z_0-9]+)'/g)].map((m) => m[1]));
    expect(codes.size).toBeGreaterThan(6);
    expect([...codes].filter((c) => !(c in HOME_TALK_ERROR_COPY) && !(c in RENTALS_ERROR_COPY)).sort()).toEqual([]);
    expect(Object.keys(HOME_TALK_ERROR_COPY).filter((c) => !codes.has(c)).sort()).toEqual([]);
    expect(homeTalkErrorMessage({ message: "talk_closed" })).toBe("This chat is closed. You can still read it.");
    // Not the Save button's "nothing to save" (RENTALS_ERROR_COPY.own_listing).
    expect(homeTalkErrorMessage({ message: "own_listing" })).toBe(HOME_TALK_ERROR_COPY.own_listing);
    expect(HOME_TALK_ERROR_COPY.own_listing).not.toBe(RENTALS_ERROR_COPY.own_listing);
  });

  it("the contact-leak refusal is shown in the trigger's own words", () => {
    const leak = "A phone number in the message. Keep phone numbers, emails and payment out of the chat; Louisiana Helpr does not allow contact details in Homes messages.";
    expect(TALK_SQL).toContain("does not allow contact details in Homes messages.'");
    expect(homeTalkErrorMessage({ message: leak })).toBe(leak);
  });

  it("a for-sale thread carries the wire-fraud line; a rental thread does not", async () => {
    talkMocks.fetchHomeTalk.mockResolvedValue(view("sale"));
    mount();
    await screen.findByText("Yes, come Saturday.");
    expect(screen.getByText(WIRE_FRAUD_LINE)).toBeTruthy();
    expect(screen.getByText("About: Two-bed shotgun near the park")).toBeTruthy();
  });

  it("a rental thread has no wire line, and only the other side's message can be reported", async () => {
    talkMocks.fetchHomeTalk.mockResolvedValue(view("rent"));
    mount();
    await screen.findByText("Yes, come Saturday.");
    expect(screen.queryByText(WIRE_FRAUD_LINE)).toBeNull();
    const reports = screen.getAllByRole("button", { name: /Report this message from Ruth/ });
    expect(reports).toHaveLength(1);
    expect(talkMocks.markHomeTalkRead).toHaveBeenCalledTimes(1);
  });

  it("the listing page offers Message the owner to others only, opens ?talk= for both, and a for-sale page has the wire line", () => {
    const lv = src("src/components/rentals/listings/ListingView.tsx");
    expect(lv).toContain("{!l.is_mine && <HomeMessageButton listingId={l.id} />}");
    expect(lv).toContain("<HomeTalkFromLink />");
    expect(lv).toContain("{sale && <p className=\"px-1 text-ds-14 font-medium\" data-home-wire-line=\"\">{WIRE_FRAUD_LINE}</p>}");
  });

  it("Messages -> Homes lists the Homes chats while Homes is on", () => {
    expect(src("src/pages/messages/useMessageSections.tsx")).toContain("if (section === \"homes\" && live.homes) empty.Lead = HomeTalkLead;");
  });

  it("the report dialog knows home_talk_message, fair housing first", () => {
    expect(REASONS.home_talk_message[0].label).toBe("Discriminates (fair housing)");
    expect(REASONS.home_talk_message.length).toBeGreaterThan(3);
    expect(REPORTED_NOUN.home_talk_message).toBe("Message");
    expect(REASON_PROMPT.home_talk_message).toBe("What's wrong with this message?");
  });

  it("the admin queue reads a Homes message report as its kept copy, never a person, with nothing to take down", () => {
    expect(src("src/components/admin/adminReports/fetchReports.ts")).toContain("&& r.reported_type !== HOME_TALK_MESSAGE_REPORT;");
    render(<ReportedCopy report={{ id: "r1", reported_type: "home_talk_message", reported_id: "m2", reported_content: "Listing: X\nFrom the owner: hi", status: "pending" }} onDone={() => {}} />);
    expect(screen.getByText("Reported Homes message:", { exact: false })).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("the five talk RPCs are allowlisted as client-called", () => {
    const allow = readFileSync(resolve(ROOT, "scripts/ci/definer-exec-allowlist.json"), "utf8");
    for (const fn of ["rentals_open_talk(uuid)", "rentals_talk_view(uuid)", "rentals_send_talk_message(uuid, text)", "rentals_my_talks()", "rentals_mark_talk_read(uuid)"]) {
      expect(allow, fn).toContain(`"${fn}": "client"`);
    }
  });
});
