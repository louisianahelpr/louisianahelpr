/**
 * Q?message-left-of-hire (owner report, 2026-10-14 7:25 PM CT, screenshot of
 * /posts > Applicants, applicant card "Yusef H."): the Message button sat on
 * its own row BELOW Hire and the decline x. Owner: "message should be to the
 * left of hire".
 *
 * On every pending applicant's card the controls read, on ONE row and in this
 * order: Message, Hire, decline (x). A hired (accepted) applicant has no Hire
 * row and keeps Message on its own.
 *
 * Narrow screens (owner pop-up, 2026-10-15): at 375 the one row left the name
 * column 4px wide (measured), so below Tailwind's `sm` (640px) the Message,
 * Hire, x row moves UNDER the name and note, full width, same order. Measured
 * sweep (2026-10-15, poster-e2e seed job): beside the row the name block first
 * fits at ~500px; 640 is the first breakpoint above it. At 750 and 1440 the row
 * stays beside the name as before.
 *
 * jsdom has no layout, so the row is asserted structurally, resolving the
 * Tailwind classes in force at each width (mobile-first: an `sm:` class applies
 * from 640px): which element is the row's flex container (a `contents` parent
 * dissolves), its direction and wrap, the row's basis and the buttons' growth.
 * The measured boxes are in the screenshot proof at 375, 750 and 1440
 * (375: name block 141px wide, not truncated; row top 238 below the note's
 * bottom 226; Message 35-157, Hire 163-290, x 296-340 across the card).
 *
 * @mutate src/pages/posts/postedJobs/applicantsPanel/ApplicantHireRow.tsx |       <MessageApplicantButton jobId={jobId} helperId={helperId} helperName={helperName} className="flex-1 sm:flex-none" />\n |
 * @mutate src/pages/posts/postedJobs/applicantsPanel/ApplicantHireRow.tsx | <div className="flex items-center gap-1.5 shrink-0 basis-full sm:basis-auto sm:mr-1"> | <div className="flex flex-col items-end gap-1.5 shrink-0 basis-full sm:basis-auto sm:mr-1">
 * @mutate src/pages/posts/postedJobs/applicantsPanel/ApplicantHireRow.tsx | <div className="flex items-center gap-1.5 shrink-0 basis-full sm:basis-auto sm:mr-1"> | <div className="flex flex-row-reverse items-center gap-1.5 shrink-0 basis-full sm:basis-auto sm:mr-1">
 * @mutate src/pages/posts/postedJobs/applicantsPanel/ApplicantHireRow.tsx | <div className="flex items-center gap-1.5 shrink-0 basis-full sm:basis-auto sm:mr-1"> | <div className="flex items-center gap-1.5 shrink-0 sm:mr-1">
 * @mutate src/pages/posts/postedJobs/ApplicantsPanel.tsx | ? "contents sm:flex sm:flex-col sm:items-end sm:gap-1 sm:shrink-0 sm:-mt-1 sm:-mr-1" | ? "flex flex-col items-end gap-1 shrink-0 -mt-1 -mr-1"
 * @mutate src/pages/posts/postedJobs/ApplicantsPanel.tsx | ? "contents sm:flex sm:flex-col sm:items-end sm:gap-1 sm:shrink-0 sm:-mt-1 sm:-mr-1" | ? "contents lg:flex lg:flex-col lg:items-end lg:gap-1 lg:shrink-0 lg:-mt-1 lg:-mr-1"
 * @mutate src/pages/posts/postedJobs/ApplicantsPanel.tsx | "flex flex-wrap sm:flex-nowrap items-start gap-3" : | "flex items-start gap-3" :
 * @mutate src/pages/posts/postedJobs/applicantsPanel/ApplicantHireRow.tsx | helperName={helperName} className="flex-1 sm:flex-none" /> | helperName={helperName} />
 * @mutate src/pages/posts/postedJobs/ApplicantsPanel.tsx |                           {app.status !== "pending" && canMessageApplicant(app.status) && ( |                           {canMessageApplicant(app.status) && (
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "or", "order", "limit", "maybeSingle", "single"]) chain[m] = () => chain;
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
  return {
    supabase: {
      from: () => chain,
      rpc: () => Promise.resolve({ data: [], error: null }),
      auth: { getSession: () => Promise.resolve({ data: { session: null }, error: null }) },
      storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: "" } }) }) },
    },
  };
});

import { ApplicantsPanel } from "@/pages/posts/postedJobs/ApplicantsPanel";
import type { EnrichedApplication, Job } from "@/components/job-card/activityConstants";

const JOB = { id: "job-1", title: "Rake the front yard", status: "open", created_at: new Date().toISOString() } as unknown as Job;
const app = (id: string, helper: string, name: string, status: string): EnrichedApplication =>
  ({
    id,
    job_id: JOB.id,
    helper_id: helper,
    status,
    message: "Do you have a rake or should I bring one?",
    created_at: new Date().toISOString(),
    profiles: { full_name: name, skills: null, user_id: helper },
  }) as unknown as EnrichedApplication;

function renderPanel(applications: EnrichedApplication[]) {
  const empty = new Map();
  render(
    <MemoryRouter initialEntries={["/posts"]}>
      <ApplicantsPanel
        selectedJob={JOB}
        setSelectedJob={() => {}}
        applications={applications}
        applicationsLoading={false}
        applicationsError={false}
        onLoadApplications={() => {}}
        onAcceptApplication={() => {}}
        onDeclineApplication={() => {}}
        neighborCountMap={empty}
        completedCountsMap={empty}
        repeatHireMap={empty}
        onTimeMap={empty}
        distanceBandMap={empty}
      />
    </MemoryRouter>,
  );
  return screen.getByRole("region", { name: /Applicants for Rake the front yard/ });
}

// tailwind.config.ts: Tailwind's default sm/md/xl/2xl, lg overridden to 900.
const SCREENS: Record<string, number> = { sm: 640, md: 768, lg: 900, xl: 1280, "2xl": 1536 };

/** The utility of one family (display, direction, wrap, basis, grow) in force at `width`. */
function utilityAt(el: Element, width: number, family: RegExp): string | null {
  let best: { min: number; util: string } | null = null;
  for (const cls of el.className.split(/\s+/).filter(Boolean)) {
    const m = /^([a-z0-9]+):(.+)$/.exec(cls);
    if (m && !(m[1] in SCREENS)) continue; // hover:, focus:, dark: ... never a layout switch here
    const min = m ? SCREENS[m[1]] : 0;
    const util = m ? m[2] : cls;
    if (!family.test(util) || min > width) continue;
    if (!best || min >= best.min) best = { min, util };
  }
  return best?.util ?? null;
}
const DISPLAY = /^(flex|inline-flex|contents|block|inline-block|grid|hidden)$/;
const DIRECTION = /^flex-(row|col|row-reverse|col-reverse)$/;
const WRAP = /^flex-(wrap|nowrap|wrap-reverse)$/;
const BASIS = /^basis-/;
const GROW = /^flex-(1|auto|initial|none)$/;

/** The element whose flex layout places `el` at `width` (a `contents` ancestor dissolves). */
function flexParentAt(el: Element, width: number): HTMLElement {
  let p = el.parentElement!;
  while (utilityAt(p, width, DISPLAY) === "contents") p = p.parentElement!;
  return p;
}
/** `el`'s laid-out children at `width`, with `contents` children flattened into their parent. */
function flexChildrenAt(el: Element, width: number): Element[] {
  return Array.from(el.children).flatMap((c) => (utilityAt(c, width, DISPLAY) === "contents" ? flexChildrenAt(c, width) : [c]));
}

function controls(region: HTMLElement, hire: HTMLElement) {
  const name = hire.getAttribute("aria-label")!.replace(/^Select /, "").replace(/ — payout setup not finished yet$/, "");
  return {
    name,
    message: within(region).getByRole("button", { name: `Message ${name}` }),
    decline: within(region).getByRole("button", { name: `Decline ${name}` }),
    nameLink: within(region).getAllByRole("link", { name }).find((a) => a.getAttribute("title") === name)!,
  };
}

describe("Q?message-left-of-hire: Message sits on the Hire row, immediately left of Hire", () => {
  it("each pending applicant's card reads Message, Hire, decline on one row", () => {
    const region = renderPanel([app("a1", "helper-1", "Yusef Harris", "pending"), app("a2", "helper-2", "Ann Boudreaux", "pending")]);
    const hires = within(region).getAllByRole("button", { name: /^Select / });
    expect(hires.length).toBe(2);
    for (const hire of hires) {
      const { name, message, decline } = controls(region, hire);
      const row = hire.parentElement!;
      expect(message.parentElement, `${name}: Message shares Hire's row`).toBe(row);
      expect(decline.parentElement).toBe(row);
      for (const width of [375, 750, 1440]) {
        expect(utilityAt(row, width, DISPLAY), `${name} @${width}: the row is a flex row`).toBe("flex");
        expect(utilityAt(row, width, DIRECTION) ?? "flex-row", `${name} @${width}: left to right`).toBe("flex-row");
        expect(utilityAt(row, width, WRAP) ?? "flex-nowrap", `${name} @${width}: never wraps`).toBe("flex-nowrap");
      }
      const kids = Array.from(row.children);
      expect(kids.indexOf(message), `${name}: Message immediately left of Hire`).toBe(kids.indexOf(hire) - 1);
      expect(kids.indexOf(decline), `${name}: decline right of Hire`).toBe(kids.indexOf(hire) + 1);
    }
  });

  it("at 375 (below sm) the row sits UNDER the name and note, full width, Message < Hire < x", () => {
    const region = renderPanel([app("a1", "helper-1", "Yusef Harris", "pending")]);
    const hire = within(region).getByRole("button", { name: /^Select / });
    const { name, message, decline, nameLink } = controls(region, hire);
    const row = hire.parentElement!;
    const W = 375;
    // The row is laid out by the card's top row (the one holding the name), not by a side column.
    const container = flexParentAt(row, W);
    expect(container.contains(nameLink), `${name}: at ${W} the row's flex container holds the name block`).toBe(true);
    expect(utilityAt(container, W, DIRECTION) ?? "flex-row").toBe("flex-row");
    expect(utilityAt(container, W, WRAP), `${name}: the top row wraps at ${W}`).toBe("flex-wrap");
    // A full-basis item in a wrapping row takes a line of its own, after the name block.
    expect(utilityAt(row, W, BASIS), `${name}: the row takes the full width at ${W}`).toBe("basis-full");
    const laid = flexChildrenAt(container, W);
    const nameBlock = laid.find((c) => c.contains(nameLink))!;
    expect(nameBlock, "the name block is its own item").toBeTruthy();
    expect(nameBlock.contains(row)).toBe(false);
    expect(laid.indexOf(row), `${name}: the row comes after the name and note`).toBeGreaterThan(laid.indexOf(nameBlock));
    expect(laid.indexOf(row), `${name}: the row is the last item, alone on its line`).toBe(laid.length - 1);
    // The name block keeps the line's width (flex-1, min-w-0), not squeezed by the row beside it.
    expect(utilityAt(nameBlock, W, GROW)).toBe("flex-1");
    // Message and Hire share the width; the x keeps its own size; order unchanged.
    expect(utilityAt(message, W, GROW), "Message grows to fill the row").toBe("flex-1");
    expect(utilityAt(hire, W, GROW), "Hire grows to fill the row").toBe("flex-1");
    expect(utilityAt(decline, W, GROW)).toBeNull();
    const kids = Array.from(row.children);
    expect([kids.indexOf(message), kids.indexOf(hire), kids.indexOf(decline)]).toEqual([0, 1, 2]);
  });

  it("at 750 and 1440 (sm and up) the row stays beside the name, in the right column, at its natural size", () => {
    const region = renderPanel([app("a1", "helper-1", "Yusef Harris", "pending")]);
    const hire = within(region).getByRole("button", { name: /^Select / });
    const { message, nameLink } = controls(region, hire);
    const row = hire.parentElement!;
    for (const W of [750, 1440]) {
      const column = flexParentAt(row, W);
      expect(column, `@${W}: the row's container is the right column`).toBe(row.parentElement);
      expect(utilityAt(column, W, DISPLAY)).toBe("flex");
      expect(utilityAt(column, W, DIRECTION)).toBe("flex-col");
      expect(column.contains(nameLink), `@${W}: the right column is beside the name, not around it`).toBe(false);
      expect(utilityAt(flexParentAt(column, W), W, WRAP) ?? "flex-nowrap", `@${W}: the top row does not wrap`).not.toBe("flex-wrap");
      expect(utilityAt(row, W, BASIS)).not.toBe("basis-full");
      expect(utilityAt(message, W, GROW), `@${W}: Message keeps its natural width`).not.toBe("flex-1");
      expect(utilityAt(hire, W, GROW), `@${W}: Hire keeps its natural width`).not.toBe("flex-1");
    }
  });

  it("each pending applicant gets exactly one Message (none left below the row)", () => {
    const region = renderPanel([app("a1", "helper-1", "Yusef Harris", "pending")]);
    expect(within(region).getAllByRole("button", { name: /^Message / })).toHaveLength(1);
  });

  it("a hired applicant (no Hire row) still has one Message", () => {
    const region = renderPanel([app("a1", "helper-1", "Yusef Harris", "accepted")]);
    expect(within(region).queryByRole("button", { name: /^Select / })).toBeNull();
    expect(within(region).getAllByRole("button", { name: /^Message / })).toHaveLength(1);
  });
});
