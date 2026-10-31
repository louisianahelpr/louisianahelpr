/**
 * Q1554 — THE HELPR'S SCHEDULED CARD LEADS WITH "CONFIRM YOU'LL BE AT THE JOB"
 * (owner, 2026-10-08): until the Helpr's day-before confirmation the primary is
 * "Confirm you'll be at the job", never "I'm on my way"; Cancel job, Directions
 * and Ask for a new date or time sit under More, not on the row.
 *
 * Renders the real ConfirmedSection (the Helpr's accepted card) at two points
 * of the pre-confirmation window: days before the start (the confirm is greyed,
 * "turns on" the day before) and inside the day-before window (the confirm is
 * live). In both, the row is exactly More + the one primary, and More holds the
 * three moves the owner named.
 *
 * @mutate src/components/job-card/JobStepCard.tsx | const isMoreOnly = (_c: ReactNode) => true; | const isMoreOnly = (_c: ReactNode) => false;
 * @mutate src/components/JobConfirmation.tsx | const HELPER_CONFIRM_LABEL = "Confirm you'll be at the job"; | const HELPER_CONFIRM_LABEL = "I'm still on";
 * @mutate src/pages/jobs/appliedJobCard/ConfirmedSection.tsx |       primaryChipKey="message" |
 * @mutate src/components/JobConfirmation.tsx |     if (hideNotYetOpen) return null; |     if (hideNotYetOpen) return <JobStepRowSlot slot="primary"><button type="button" disabled>Confirm you'll be at the job</button></JobStepRowSlot>;
 * @mutate src/pages/jobs/appliedJobCard/ConfirmedSection.tsx | <DirectionsButton key="directions" location={job.location} />, | null,
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AppliedApp, Job } from "@/components/job-card/activityConstants";

vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(), notifyJobParty: vi.fn() }));
vi.mock("@/lib/haptics", () => ({
  hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn(),
  hapticMedium: vi.fn(), hapticSelection: vi.fn(), hapticWarning: vi.fn(),
}));
vi.mock("@/components/PhotoProof", () => ({
  PhotoProofGroup: () => null,
  PhotoProofDialog: () => null,
  PhotoProofRequirementNote: () => null,
  PhotoProofCaptureChip: () => null,
}));
vi.mock("@/integrations/supabase/client", () => {
  const result = { data: null, error: null };
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "neq", "in", "order", "limit", "insert", "update", "upsert", "delete", "gte", "lte", "is", "not", "filter"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.single = vi.fn(() => Promise.resolve(result));
  chain.maybeSingle = vi.fn(() => Promise.resolve(result));
  chain.then = (res: (v: typeof result) => unknown) => Promise.resolve(result).then(res);
  return {
    supabase: {
      ...chain,
      channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
      removeChannel: vi.fn(),
      rpc: vi.fn(() => Promise.resolve(result)),
      auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })) },
    },
  };
});

import { ConfirmedSection } from "@/pages/jobs/appliedJobCard/ConfirmedSection";
import { pinJobClock } from "@/test/helpers/pinJobClock";

// Noon Central, so "tomorrow 15:00" and "in four days" never cross a gate.
pinJobClock();

beforeAll(() => {
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
});

const HELPER = "helper-1";
const NOW = Date.now();
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const centralDay = (days: number) =>
  new Date(NOW + days * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

function makeJob(dateNeeded: string): Job {
  return {
    id: "job-1",
    title: "Mow the lawn",
    description: "Front and back",
    location: "Lafayette, LA",
    customer_id: "poster-1",
    helper_id: HELPER,
    budget: 100,
    category: "yard_work",
    date_needed: dateNeeded,
    start_time: "15:00",
    latitude: null,
    longitude: null,
    // Accepted (the offer was taken), but the day-before tap has not happened.
    helper_confirmed_at: ago(2),
    helper_dayof_confirmed_at: null,
    poster_confirmed_at: null,
    poster_confirmed_working_at: null,
    helper_on_the_way_at: null,
    helper_arrived_at: null,
    helper_completed_at: null,
    poster_completed_at: null,
    status: "accepted",
  } as unknown as Job;
}

async function renderCard(dateNeeded: string) {
  const job = makeJob(dateNeeded);
  const app = { id: "app-1", job_id: job.id, helper_id: HELPER, status: "accepted", created_at: ago(72), job, posterName: "Lexi L." } as unknown as AppliedApp;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const out = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ConfirmedSection app={app} job={job} userId={HELPER} initialTracking={null} navigate={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  return out;
}

const label = (el: Element) => (el.getAttribute("aria-label") || el.textContent || "").trim();

async function readCard(dateNeeded: string) {
  const { container } = await renderCard(dateNeeded);
  const card = container.querySelector("[data-job-step]");
  expect(card, "ConfirmedSection no longer renders through JobStepCard").not.toBeNull();
  const row = card!.querySelector("[data-job-step-row]");
  expect(row, "the card has no action row").not.toBeNull();
  const rowControls = [...row!.querySelectorAll<HTMLElement>("button, a[href]")];
  const more = row!.querySelector<HTMLElement>("[data-job-step-overflow]");
  expect(more, "no More control on the Helpr's scheduled card").not.toBeNull();
  await act(async () => { fireEvent.click(more!); });
  const panel = document.querySelector("[data-job-step-overflow-panel]");
  expect(panel, "More did not open").not.toBeNull();
  const moreLabels = [...panel!.querySelectorAll<HTMLElement>("button, a[href]")].map(label);
  const primaries = rowControls.filter((el) => el !== more);
  return { primaries, primaryLabels: primaries.map(label), moreLabels, cardText: card!.textContent ?? "" };
}

describe("Q1554 — the Helpr's scheduled card: Confirm first, the rest under More", () => {
  // Owner 2026-10-21 (lead ruling the same day): before the window the primary is what the stage needs,
  // "Message <poster>", never a greyed confirm; a line says when confirming opens. Inside it, the live confirm.
  for (const [name, days, want] of [
    ["four days out (Message the poster; the line says when confirming opens)", 4, /^Message Lexi$/],
    ["the day before (confirm live)", 1, /Confirm you'll be at the job/],
  ] as const) {
    it(name, async () => {
      const { primaries, primaryLabels, moreLabels, cardText } = await readCard(centralDay(days));

      // The row is More + ONE primary: the action this stage needs, always live.
      expect(primaryLabels, `row controls besides More: [${primaryLabels.join(" | ")}]`).toHaveLength(1);
      expect(primaryLabels[0]).toMatch(want);
      expect(cardText).not.toMatch(/I'm on my way/);
      const disabled = primaries[0].hasAttribute("disabled") || primaries[0].getAttribute("aria-disabled") === "true";
      expect(disabled, "the row's primary is greyed: a disabled future step").toBe(false);
      if (days > 1) {
        expect(cardText).toMatch(/Confirm the day before\. Opens [A-Z][a-z]{2} 12:00 AM/);
        expect(cardText).not.toMatch(/Confirm you'll be at the job/);
      }
      // Message is the primary OR a More item, never both (primaryChipKey).
      expect(moreLabels.filter((l) => /^Message/.test(l)).length, `More: [${moreLabels.join(" | ")}]`).toBe(days > 1 ? 0 : 1);

      // The three moves the owner named live under More, not on the row.
      expect(moreLabels.length, "More holds fewer moves than the owner named").toBeGreaterThan(2);
      for (const want of [/^Cancel/, /Directions/, /Ask for a new date or time/]) {
        expect(moreLabels.some((l) => want.test(l)), `More is missing ${want}: [${moreLabels.join(" | ")}]`).toBe(true);
        expect(primaryLabels.some((l) => want.test(l)), `${want} is on the row`).toBe(false);
      }
    });
  }
});
