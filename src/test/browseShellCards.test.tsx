/**
 * PERF-SHELL (Q652): the job cards api/share.ts puts into /browse's raw HTML carry ONLY what a guest already sees,
 * priced and labelled exactly as the app's guest card is, and drawn with the guest JobCard's own classes.
 *
 * Pins, each against the app's own code (never a hand list):
 *   1. the take-home equals guestTakeHome (GuestJobPreview.tsx) over a grid of budgets, urgent fees, crews and fee
 *      stamps (percent, flat, flat-free, giveaway), and the fee rate equals TIER_PERKS.free;
 *   2. the category labels equal JOB_CATEGORY_LABELS, both ways;
 *   3. the title check flags every phone fixture and every email / payment / off-platform line the app's scanner
 *      flags (it may flag more, never less), plus street addresses and test posts;
 *   4. only open, live, non-seed rows are drawn, at most SHELL_CARD_COUNT, and no id, description, coordinate or
 *      street ever reaches the markup;
 *   5. every class string the shell card uses is on the matching element of the REAL rendered guest JobCard.
 *
 * @mutate src/lib/browseShellCards.mjs |   const net = perHelper - commission + urgent / helpers; |   const net = perHelper - commission + urgent;
 * @mutate src/lib/browseShellCards.mjs |     j.status === "open" && |     j.status !== "closed" &&
 * @mutate src/lib/browseShellCards.mjs |   if (/[0-9]{3,}/.test(t.replace(/[^0-9a-zA-Z]/g, ""))) return "digits"; |   if (/[0-9]{11,}/.test(t)) return "digits";
 * @mutate src/index.css | #lh-browse-shell { visibility: visible !important; } | #lh-browse-shell { visibility: visible; }
 * @mutate src/lib/browseShellCards.mjs |   catLabel: "job-cat-label inline-flex | catLabel: "job-cat-labelx inline-flex
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import fs from "node:fs";
import { blankCssComments } from "./helpers/blankNonCode";

vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeDollars: () => 0, useFirstPayoutFeeCents: () => 0 }));
vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => "idle" }));
vi.mock("@/lib/haptics", () => ({ hapticLight: vi.fn() }));

import JobCard from "@/components/dashboard/JobCard";
import { guestTakeHome, GUEST_FEE_PERCENT, type GuestJob } from "@/components/dashboard/GuestJobPreview";
import { JOB_CATEGORY_LABELS } from "@/lib/jobCategories";
import { scanMessage } from "@/lib/messageScanner";
import type { EnrichedJob } from "@/components/dashboard/types";
import {
  SHELL_CARD_CLASSES,
  SHELL_CARD_COUNT,
  SHELL_CATEGORY_LABELS,
  SHELL_GUEST_FEE_PERCENT,
  browseShellHtml,
  selectShellJobs,
  shellTakeHomeDollars,
  shellTitleProblem,
  withBrowseShell,
} from "@/lib/browseShellCards.mjs";

const NOW = Date.parse("2026-11-01T12:00:00Z");
const row = (o: Record<string, unknown> = {}) => ({
  title: "Mow the front yard",
  category: "yard_work",
  budget: 85,
  location: "Lafayette, LA",
  status: "open",
  expires_at: null,
  boost_expires_at: null,
  boosted_at: null,
  created_at: "2026-10-31T12:00:00Z",
  is_urgent: false,
  urgent_fee: 0,
  is_group_job: false,
  helpers_needed: 1,
  helper_fee_flat_cents: null,
  helper_fee_percent: null,
  ...o,
});

describe("the shell card's take-home is the guest card's", () => {
  it("free-tier rate", () => expect(SHELL_GUEST_FEE_PERCENT).toBe(GUEST_FEE_PERCENT));
  it("over a grid of jobs", () => {
    const stamps = [
      { helper_fee_flat_cents: null, helper_fee_percent: null },
      { helper_fee_flat_cents: null, helper_fee_percent: 12 },
      { helper_fee_flat_cents: 70, helper_fee_percent: 10 },
      { helper_fee_flat_cents: "70", helper_fee_percent: null },
      { helper_fee_flat_cents: 0, helper_fee_percent: 0 },
      { helper_fee_flat_cents: 0, helper_fee_percent: 5 },
      { helper_fee_flat_cents: 700, helper_fee_percent: 0 },
    ];
    let n = 0;
    for (const budget of [0, 1, 7.5, 20, 33.33, 85, 120, 999.99, 2500])
      for (const urgent_fee of [0, 5, 12.5])
        for (const [is_group_job, helpers_needed] of [[false, 1], [true, 3], [true, 0]] as const)
          for (const stamp of stamps) {
            const j = row({ budget, urgent_fee, is_group_job, helpers_needed, ...stamp });
            const app = guestTakeHome(j as unknown as GuestJob, 0);
            expect(shellTakeHomeDollars(j), JSON.stringify(j)).toBe(app == null ? null : Math.floor(Math.round(app * 100) / 100));
            n++;
          }
    expect(n).toBeGreaterThan(500);
  });
});

describe("labels", () => {
  it("equal JOB_CATEGORY_LABELS both ways", () => {
    expect(SHELL_CATEGORY_LABELS).toEqual(JOB_CATEGORY_LABELS);
    expect(Object.keys(SHELL_CATEGORY_LABELS).length).toBeGreaterThan(20);
  });
});

describe("the title check", () => {
  const fixtures = JSON.parse(fs.readFileSync("src/lib/contactLeakPhoneFixtures.json", "utf8")) as { phone: string[]; notPhone: string[] };
  const extra = [
    "email me at sam@example.com", "pay by Venmo", "Zelle only", "cash app ok", "paypal me", "whatsapp me",
    "cash only, help move couch", "skip the fee please", "text me 225 555 0199", "dm me for details",
    "five zero four five five five one two one two",
  ];
  it("flags everything the app's scanner flags", () => {
    let flagged = 0;
    for (const t of [...fixtures.phone, ...fixtures.notPhone, ...extra]) {
      if (scanMessage(t).length > 0) {
        expect(shellTitleProblem(t), t).not.toBeNull();
        flagged++;
      }
    }
    expect(flagged).toBeGreaterThan(20);
  });
  it("flags street addresses, house numbers and test posts; passes plain titles", () => {
    for (const t of ["Mow lawn at 1234 Elm St", "Clean 412 Pinhook Rd", "Move a couch on 5 Main Street", "TEST job please ignore", "e2e seed job", "visit www.example.net"])
      expect(shellTitleProblem(t), t).not.toBeNull();
    for (const t of ["Mow the front yard", "Help moving 2 couches", "Deep clean a 3 bedroom house", "Assemble an IKEA dresser"])
      expect(shellTitleProblem(t), t).toBeNull();
  });
});

describe("which rows are drawn, and what reaches the markup", () => {
  it("open, live, non-seed, clean, at most SHELL_CARD_COUNT, lead order", () => {
    const rows = [
      row({ title: "Old one", created_at: "2026-10-01T00:00:00Z" }),
      row({ title: "Crew filling", status: "accepted" }),
      row({ title: "Expired", expires_at: "2026-10-31T00:00:00Z" }),
      row({ title: "Seeded", is_seed: true }),
      row({ title: "Leaky 225-555-0199" }),
      row({ title: "No town", location: "" }),
      row({ title: "No budget", budget: null }),
      row({ title: "Urgent", is_urgent: true, created_at: "2026-09-01T00:00:00Z" }),
      row({ title: "Boosted", boost_expires_at: "2026-11-02T00:00:00Z", created_at: "2026-09-02T00:00:00Z" }),
      row({ title: "Newest", created_at: "2026-11-01T11:00:00Z" }),
      row({ title: "Second", created_at: "2026-10-30T00:00:00Z" }),
    ];
    expect(selectShellJobs(rows, NOW).map((j) => j.title)).toEqual(["Urgent", "Boosted", "Newest", "Second"]);
    expect(SHELL_CARD_COUNT).toBe(4);
    expect(browseShellHtml([], NOW)).toBe("");
    expect(browseShellHtml([row({ status: "accepted" })], NOW)).toBe("");
  });
  it("escapes the title and carries no private field", () => {
    const html = browseShellHtml([row({
      id: "11111111-1111-1111-1111-111111111111", title: `Fix <b>"door"</b> & gate`, description: "Gate code 4421",
      latitude: 30.22, longitude: -92.01, customer_id: "22222222-2222-2222-2222-222222222222", location: "Oil Center, Lafayette, LA",
    })], NOW);
    expect(html).toContain("Fix &lt;b&gt;&quot;door&quot;&lt;/b&gt; &amp; gate");
    expect(html).not.toMatch(/1111|2222|Gate code|30\.22|92\.01|Oil Center|<b>/);
    expect(html).toContain(">Lafayette<");
    expect(html).toContain(">74<"); // $85 at the free tier, floored
    expect(html).toContain(">Yard work<");
    const doc = `<body><div id="root" style="x"><div id="boot-loader"></div></div></body>`;
    expect(withBrowseShell(doc, [row()], NOW)).toMatch(/^<body><div id="root" style="x"><div id="boot-loader"><div id="lh-browse-shell"[\s\S]*<\/div><\/div><\/body>$/);
    expect(withBrowseShell(`<div id="root">\n<div\n  id="boot-loader"\n  role="status"\n>`, [row()], NOW)).toMatch(/role="status"\n><div id="lh-browse-shell"/);
    expect(withBrowseShell(doc, [], NOW)).toBe(doc);
  });
});

describe("the overlay never paints unstyled", () => {
  it("hidden inline, shown by the app stylesheet, which Tailwind scans for the card classes", () => {
    expect(browseShellHtml([row()], NOW)).toMatch(/^<div id="lh-browse-shell" [^>]*style="[^"]*visibility:hidden"/);
    const css = blankCssComments(fs.readFileSync("src/index.css", "utf8"));
    expect(css).toContain("#lh-browse-shell { visibility: visible !important; }");
    expect(fs.readFileSync("tailwind.config.ts", "utf8")).toContain('"./src/lib/browseShellCards.mjs"');
  });
});

describe("the shell card wears the real guest JobCard's classes", () => {
  it("each class string is on the matching element", () => {
    const job = { ...row(), id: "j1", description: "x", date_needed: null, updated_at: "2026-10-31T12:00:00Z", pricing_mode: "set_price", photos: [] } as unknown as EnrichedJob;
    const { container } = render(
      <MemoryRouter>
        <JobCard job={job} variant="guest" effectiveFee={GUEST_FEE_PERCENT} currentUserId={undefined} showApply onApply={() => {}} onReport={() => {}} onSelect={() => {}} onToggleSave={() => {}} index={0} />
      </MemoryRouter>,
    );
    const real = (sel: string) => container.querySelector(sel)?.getAttribute("class") ?? `(no ${sel})`;
    const c = SHELL_CARD_CLASSES;
    expect(c.root).toBe(real("[data-feed-card]"));
    expect(c.inner).toBe(real("[data-feed-card] > div"));
    expect(c.catRow).toBe(real("[data-feed-card] > div > div:first-child"));
    expect(c.catLabel).toBe(real(".job-cat-label"));
    expect(c.title).toBe(real(".job-card-title"));
    expect(c.titleRow).toBe(container.querySelector(".job-card-title")?.parentElement?.getAttribute("class"));
    expect(c.body).toBe(container.querySelector(".job-card-title")?.parentElement?.parentElement?.getAttribute("class"));
    expect(c.chip).toBe(real(".money-chip"));
    expect(c.amount).toBe(real(".money-chip > span"));
    expect(c.metaRow).toBe(real(".job-meta-row"));
    expect(c.metaWrap).toBe(container.querySelector(".job-meta-row")?.parentElement?.getAttribute("class"));
    expect(container.querySelector(".job-card-title")?.textContent).toBe("Mow the front yard");
    expect(container.querySelector(".money-chip")?.textContent).toBe("$74");
  });
});
