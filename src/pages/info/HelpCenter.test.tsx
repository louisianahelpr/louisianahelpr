/**
 * /help shipped with `grep -c btn-grad-primary` = 0 in its body and seven FAQ
 * anchors that nothing honoured.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import HelpCenter, { LEGACY_TOPIC_ANCHORS, filterFaqSections } from "./HelpCenter";
import { COMMON_PROBLEMS, FAQ_SECTIONS } from "./helpCenter/helpCenterContent";
import { JOB_CATEGORY_LABELS, JOB_CATEGORY_VALUES } from "@/lib/jobCategories";
import { CREDENTIAL_TIER_CATEGORIES } from "@/components/postjob/detailsSection/detailsSectionConstants";
import { shouldShowDisputeLink } from "@/components/jobs/DisputeLink";

vi.mock("@/components/help/HelpEntry", () => ({ HelpEntry: () => null })); // Its top bar's Help needs the app's providers.
vi.mock("@/hooks/usePageMeta", () => ({ usePageMeta: () => {} }));
// F236/F258: the setup fee amount is read live (a query); the tests give it the prod value.
vi.mock("@/hooks/useOnboardingFee", async (orig) => ({ ...(await orig<typeof import("@/hooks/useOnboardingFee")>()), useOnboardingFeeCents: () => 200 }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) } },
}));

// The Declutter shipping answers read the declutter_shipping switch (a query); off unless a test turns it on.
const feature = vi.hoisted(() => ({ shipping: false }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: (k: string) => k === "declutter_shipping" && feature.shipping }));

// jsdom has no layout, so scrollIntoView is not implemented on the prototype.
beforeEach(() => {
  feature.shipping = false;
  Element.prototype.scrollIntoView = vi.fn();
  window.history.replaceState({}, "", "/help");
});

const renderHelp = () =>
  render(
    <MemoryRouter initialEntries={["/help"]}>
      <HelpCenter />
    </MemoryRouter>,
  );

// F033 (owner UI audit 11-09): the answers ran the full 1440px width (~1,250px a line). The FAQ column is capped at
// 760px and centred.
// @mutate src/pages/info/HelpCenter.tsx | page-measure max-w-[760px] space-y-section | page-measure space-y-section
describe("/help answers keep a reading measure (F033)", () => {
  it("the FAQ column is capped at 760px and centred", () => {
    const { container } = renderHelp();
    const col = container.querySelector("#faq [data-help-measure]") as HTMLElement;
    expect(col).not.toBeNull();
    const cls = col.className.split(/\s+/);
    expect(cls).toContain("max-w-[760px]");
    expect(cls).toContain("mx-auto");
    // Every topic sits inside the capped column.
    expect(col.querySelectorAll("[id^='faq-']").length).toBeGreaterThan(3);
  });
});

// F034 (owner UI audit 11-09; owner decided 11-09 to ADD the search back, reversing the 2026-08-22 removal):
// "Search help" at the top filters the questions as you type.
// @mutate src/pages/info/HelpCenter.tsx |         return terms.every((forms) => forms.some((w) => text.includes(w))); |         return true;
// @mutate src/pages/info/HelpCenter.tsx |   const open = searching \|\| manualOpen \|\| (targeted && !dismissed); |   const open = manualOpen \|\| (targeted && !dismissed);
// @mutate src/pages/info/HelpCenter.tsx |   const sections = filterFaqSections(allSections, query); |   const sections = allSections;
describe("/help search (F034)", () => {
  it("filters questions by every word typed, across question, answer and topic; empty returns all", () => {
    const total = FAQ_SECTIONS.reduce((n, s) => n + s.items.length, 0);
    expect(total).toBeGreaterThan(20);
    expect(filterFaqSections(FAQ_SECTIONS, "  ").reduce((n, s) => n + s.items.length, 0)).toBe(total);
    const hits = filterFaqSections(FAQ_SECTIONS, "refund");
    const n = hits.reduce((k, s) => k + s.items.length, 0);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(total);
    for (const s of hits) for (const i of s.items) expect(`${s.topic} ${i.q} ${i.a}`.toLowerCase()).toContain("refund");
    expect(filterFaqSections(FAQ_SECTIONS, "zzqxnotaword")).toEqual([]);
  });

  it("the page: typing opens only the matching topics with their matches; no match says so; clear brings all back", () => {
    const { container } = renderHelp();
    const box = screen.getByRole("searchbox", { name: "Search help" });
    const topicsAll = container.querySelectorAll("#faq [aria-controls^='faq-panel-']").length;
    expect(topicsAll).toBeGreaterThan(3);
    fireEvent.change(box, { target: { value: "refund" } });
    const shown = [...container.querySelectorAll("#faq [aria-controls^='faq-panel-']")];
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThanOrEqual(topicsAll);
    for (const t of shown) expect(t.getAttribute("aria-expanded")).toBe("true");
    fireEvent.change(box, { target: { value: "zzqxnotaword" } });
    expect(container.querySelector("[data-help-no-match]")?.textContent).toMatch(/No answers match/);
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(container.querySelectorAll("#faq [aria-controls^='faq-panel-']").length).toBe(topicsAll);
  });
});

describe("/help offers one unambiguous way to reach a person", () => {
  it("renders the escape hatch as the shared GLOSSY primary control, not an inline link", () => {
    renderHelp();
    const cta = screen.getByRole("link", { name: /Contact support/i });
    // The gloss lives in `btn-grad-primary` (index.css). Asserting the CLASS is
    // the only thing jsdom can see; the two documented ways to lose the gloss
    // are a Tailwind variant over a hand-written class and an inline
    // `background` shorthand — neither is used here, and neither is present in
    // the element's own style attribute.
    expect(cta.className).toContain("btn-grad-primary");
    expect(cta.getAttribute("style") ?? "").not.toMatch(/background\s*:/);
    expect(cta.getAttribute("href")).toBe("/support");
  });

  it("keeps exactly ONE primary action in the page BODY", () => {
    // Scoped to the FAQ section, not the document: the shared marketing navbar
    // carries its own glossy "Join free" on every public route, which is
    // chrome rather than this page's primary action. Before this change the
    // body's count was ZERO — that nav CTA was the page's only gloss, which is
    // exactly why the raw `grep -c btn-grad-primary src/pages/info/HelpCenter.tsx`
    // reading of 0 was the accurate one.
    const { container } = renderHelp();
    const body = container.querySelector("#faq")!;
    expect(body.querySelectorAll(".btn-grad-primary").length).toBe(1);
  });
});

describe("/help FAQ anchors are real destinations", () => {
  it("every section is collapsed on a plain visit", () => {
    renderHelp();
    for (const b of screen.getAllByRole("button", { expanded: false })) {
      expect(b.getAttribute("aria-expanded")).toBe("false");
    }
    expect(screen.queryAllByRole("button", { expanded: true })).toHaveLength(0);
  });

  it("stamps an id for every topic", () => {
    const { container } = renderHelp();
    const ids = [...container.querySelectorAll("[id^='faq-']")].map((n) => n.id);
    expect(ids).toContain("faq-payments-how-your-money-is-held");
    expect(ids).toContain("faq-trust-safety");
  });

  it("#faq-<topic> OPENS that topic and scrolls to it", async () => {
    window.history.replaceState({}, "", "/help#faq-payments-how-your-money-is-held");
    const { container } = renderHelp();
    const section = container.querySelector("#faq-payments-how-your-money-is-held")!;
    const header = section.querySelector("button")!;
    await waitFor(() => expect(header.getAttribute("aria-expanded")).toBe("true"));
    // …and ONLY that one. Landing on an anchor must not unfold the whole page.
    expect(screen.getAllByRole("button", { expanded: true })).toHaveLength(1);
  });

  // JOBS-28: the topic was "Payments & Escrow". Links sent before the rename
  // (support replies, notices) still open the payments topic, not nothing.
  // @mutate src/pages/info/HelpCenter.tsx | return raw ? LEGACY_TOPIC_ANCHORS[raw] ?? raw : null; | return raw;
  it("the old #faq-payments-escrow link still opens the payments topic", async () => {
    window.history.replaceState({}, "", "/help#faq-payments-escrow");
    const { container } = renderHelp();
    const header = container.querySelector("#faq-payments-how-your-money-is-held button")!;
    await waitFor(() => expect(header.getAttribute("aria-expanded")).toBe("true"));
    expect(screen.getAllByRole("button", { expanded: true })).toHaveLength(1);
  });

  it("every old anchor alias still points at a live topic, and no live topic shadows it", () => {
    const { container } = renderHelp();
    const ids = new Set([...container.querySelectorAll("[id^='faq-']")].map((n) => n.id));
    const stale = Object.entries(LEGACY_TOPIC_ANCHORS)
      .filter(([old, target]) => !ids.has(target) || ids.has(old))
      .map(([old]) => `stale topic anchor alias ${old} — point it at a live topic or remove it`);
    expect(Object.keys(LEGACY_TOPIC_ANCHORS).length).toBeGreaterThan(0);
    expect(stale).toEqual([]);
  });

  it("an addressed section can still be closed by hand", async () => {
    window.history.replaceState({}, "", "/help#faq-payments-how-your-money-is-held");
    const { container } = renderHelp();
    const header = container.querySelector("#faq-payments-how-your-money-is-held button") as HTMLElement;
    await waitFor(() => expect(header.getAttribute("aria-expanded")).toBe("true"));
    fireEvent.click(header);
    await waitFor(() => expect(header.getAttribute("aria-expanded")).toBe("false"));
  });

  it("an unknown hash opens nothing rather than guessing", () => {
    window.history.replaceState({}, "", "/help#faq-does-not-exist");
    renderHelp();
    expect(screen.queryAllByRole("button", { expanded: true })).toHaveLength(0);
  });
});

describe("/help open and closed sections do not look identical", () => {
  it("changes the section's own surface, not just the chevron", async () => {
    const { container } = renderHelp();
    const section = container.querySelector("#faq-getting-started") as HTMLElement;
    // Spec v2: one card style; open turns the border olive (a class change).
    const closed = section.className;
    fireEvent.click(section.querySelector("button")!);
    await waitFor(() => expect(section.querySelector("button")!.getAttribute("aria-expanded")).toBe("true"));
    expect(section.className).not.toBe(closed);
  });

  it("wires the header to the panel it controls", async () => {
    const { container } = renderHelp();
    const section = container.querySelector("#faq-getting-started") as HTMLElement;
    const header = section.querySelector("button")!;
    expect(header.getAttribute("aria-controls")).toBe("faq-panel-getting-started");
    fireEvent.click(header);
    await waitFor(() => expect(container.querySelector("#faq-panel-getting-started")).toBeTruthy());
  });
});

describe("/help FAQ copy is derived from config, not retyped", () => {
  const allAnswers = FAQ_SECTIONS.flatMap((section) => section.items.map((item) => `${item.q} ${item.a}`)).join("\n");

  // JOBS-28 (lead 10-31): members read "Louisiana Helpr holds the money", never
  // "Escrow", in Help's topics, questions and answers.
  // @mutate src/pages/info/helpCenter/helpCenterContent.ts | q: "How does Louisiana Helpr hold my payment?", | q: "What is Helpr Escrow?",
  it("no Help topic, question or answer says escrow", () => {
    expect(FAQ_SECTIONS.length).toBeGreaterThan(5);
    const copy = FAQ_SECTIONS.flatMap((section) => [section.topic, ...section.items.map((item) => `${item.q} ${item.a}`)]);
    expect(copy.filter((line) => /escrow/i.test(line))).toEqual([]);
    expect(allAnswers).toContain("How does Louisiana Helpr hold my payment?");
  });

  // Memberships RETIRED (owner 2026-11-04): the FAQ names no plan at all
  // (helpCenterPricingCopy.test.ts holds the full check).
  it("names no membership plan anywhere in the FAQ", () => {
    for (const name of ["Basic", "Pro", "Plus", "Elite"]) expect(allAnswers).not.toMatch(new RegExp(`\\b${name}\\b`));
    expect(allAnswers).not.toMatch(/\bmemberships?\b/i);
  });

  it("names the credential categories the post form actually offers, and no others", () => {
    // The trade-credential answer hand-typed "handyman, painting, moving, and
    // assembly"; Storm Prep and Yard Work were added to the form on 2026-09-06
    // and the sentence stayed wrong. Derived from the form's own set now.
    const credentialAnswer = allAnswers.match(/On trade jobs \(([^)]+)\)/)?.[1];
    expect(credentialAnswer).toBeTruthy();
    for (const value of JOB_CATEGORY_VALUES) {
      const named = credentialAnswer!.toLowerCase().includes(JOB_CATEGORY_LABELS[value].toLowerCase()); // "HVAC" keeps its capitals (AUD31-58)
      expect(named).toBe(CREDENTIAL_TIER_CATEGORIES.has(value));
    }
  });
});

describe("/help dispute answer matches the cards (VN-28)", () => {
  // VN-28 (owner, 2026-09-14): "they can't report a job once it's done". The
  // cards dropped the post-completion dispute window, but this answer still
  // promised the option "stays available for 7 days after completion" — a
  // time-limited money claim pointed at a control that no longer exists. The
  // rule is read from the predicate itself so the copy check follows the code.
  const disputeAnswer = FAQ_SECTIONS.flatMap((s) => s.items).find((i) => /dispute/i.test(i.q))?.a ?? "";
  const completedJob = {
    status: "completed",
    poster_completed_at: new Date().toISOString(),
    helper_completed_at: new Date().toISOString(),
    disputed_at: null,
    revision_requested_at: null,
  };

  it("promises no dispute window after completion while the cards offer none", () => {
    expect(disputeAnswer).not.toBe("");
    expect(shouldShowDisputeLink(completedJob, "customer")).toBe(false);
    expect(shouldShowDisputeLink(completedJob, "helper")).toBe(false);
    expect(disputeAnswer).not.toMatch(/\d+\s*days?\s+(after|past)\s+completion/i);
    expect(disputeAnswer).not.toMatch(/stays available/i);
  });

  // Owner, 2026-09-14: "if the job is done, its done. period. too late to ask
  // for help. no link". The answer used to send a finished job to Support.
  it("says done is final and sends no one to Support about a finished job", () => {
    // F036 (owner UI audit 2026-11-09): final at the poster's approval, not at "marked done".
    expect(disputeAnswer).toMatch(/once the person who posted the job approves it, it's final/i);
    expect(disputeAnswer).not.toMatch(/support/i);
    expect(disputeAnswer).not.toMatch(/contact (us|our team)/i);
    // No link of any kind: no URL, no route, no email.
    expect(disputeAnswer).not.toMatch(/https?:|www\.|mailto:|@|\/(support|help|contact)\b/i);
  });

  it("says Report a Problem is there while the job is in progress", () => {
    expect(disputeAnswer).toMatch(/Report a Problem is there from On the way until the person who posted the job approves it/);
  });

  it("names the Helpr's mid-job control by the label the card renders", () => {
    expect(disputeAnswer).toContain("Report a Problem");
  });
});

// Proof this guard can fail: /help#faq-<topic> is a real destination — the shape
// a support reply pastes. Dropping the `targeted` term leaves the anchor inert:
// the page loads with every section shut and nothing scrolled to.
// @mutate src/pages/info/HelpCenter.tsx | const open = searching \|\| manualOpen \|\| (targeted && !dismissed); | const open = searching \|\| manualOpen;

// Q2259 S8: the shipping answers show only where declutter_shipping is on; elsewhere "Shipping isn't offered." stays.
// @mutate src/pages/info/HelpCenter.tsx | const allSections = withSetupFeeAmount(shippingOn ? withDeclutterShipping(FAQ_SECTIONS) : FAQ_SECTIONS, setupFeeLabel); | const allSections = withSetupFeeAmount(FAQ_SECTIONS, setupFeeLabel);
describe("/help Declutter shipping answers follow the switch", () => {
  const open = async () => {
    window.history.replaceState({}, "", "/help#faq-declutter");
    const view = renderHelp();
    await waitFor(() => expect(view.container.querySelector("#faq-declutter button")?.getAttribute("aria-expanded")).toBe("true"));
    return view;
  };
  it("off: says shipping isn't offered and has no shipping answer", async () => {
    const { container } = await open();
    const text = container.querySelector("#faq-declutter")?.textContent ?? "";
    expect(text).toContain("How do I get the item?");
    expect(screen.queryByText("How does shipping work when I buy?")).toBeNull();
  });
  it("on: shows the three shipping answers", async () => {
    feature.shipping = true;
    await open();
    for (const q of ["How does shipping work when I buy?", "What if my package doesn't come, or arrives broken?", "How do I ship something I sold?"]) {
      expect(screen.getByText(q)).toBeTruthy();
    }
  });
});

// F411 (audit 11-10, High): someone with a problem in hand had to guess which of seven topics held the answer, no
// answer was called "How do I cancel a job?" or covered a no-show, and "What is the cancellation rate?" did not say
// where it shows. A "Common problems" card row at the top opens three steps per problem.
// @mutate src/pages/info/HelpCenter.tsx | {!searching && <CommonProblems setupFeeLabel={setupFeeLabel} />} | {false && <CommonProblems setupFeeLabel={setupFeeLabel} />}
// @mutate src/pages/info/HelpCenter.tsx | onClick={() => setOpenId(open ? null : problem.id)} | onClick={() => setOpenId(null)}
// @mutate src/pages/info/helpCenter/helpCenterContent.ts | q: "What does the cancellation rate on a profile mean?", | q: "What is the cancellation rate?",
describe("/help Common problems (F411)", () => {
  const TITLES = ["Cancel a job", "My Helpr did not show up", "I don't like the work", "I was charged too much"];

  it("four cards, the finding's words, each with exactly three steps that name a real control", () => {
    expect(COMMON_PROBLEMS.map((p) => p.title)).toEqual(TITLES);
    for (const p of COMMON_PROBLEMS) expect(p.steps).toHaveLength(3);
    const steps = Object.fromEntries(COMMON_PROBLEMS.map((p) => [p.title, p.steps.join(" ")]));
    expect(steps["Cancel a job"]).toContain("Cancel job");
    expect(steps["My Helpr did not show up"]).toContain("Report no-show");
    expect(steps["I don't like the work"]).toContain("Something's not right");
    expect(steps["I was charged too much"]).toContain("Receipts");
  });

  it("the row sits above the topics; a card opens its three steps, one card at a time; a search hides the row", () => {
    const { container } = renderHelp();
    const row = container.querySelector("[data-help-common-problems]") as HTMLElement;
    expect(row).not.toBeNull();
    // Above the first topic in document order.
    const firstTopic = container.querySelector("#faq-getting-started")!;
    expect(row.compareDocumentPosition(firstTopic) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const cards = TITLES.map((t) => screen.getByRole("button", { name: t }));
    for (const c of cards) expect(c.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelectorAll("[id^='help-problem-'] li")).toHaveLength(0);

    fireEvent.click(cards[0]);
    expect(cards[0].getAttribute("aria-expanded")).toBe("true");
    const items = [...container.querySelectorAll("#help-problem-cancel-a-job li")].map((li) => li.textContent ?? "");
    expect(items).toHaveLength(3);
    expect(items[0]).toContain("Cancel job");

    fireEvent.click(cards[1]);
    expect(cards[0].getAttribute("aria-expanded")).toBe("false");
    expect(cards[1].getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelectorAll("[id^='help-problem-'] li")).toHaveLength(3);
    fireEvent.click(cards[1]);
    expect(container.querySelectorAll("[id^='help-problem-'] li")).toHaveLength(0);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search help" }), { target: { value: "refund" } });
    expect(container.querySelector("[data-help-common-problems]")).toBeNull();
  });

  it("the charged-too-much steps carry the live setup fee amount, as the fee answer does (F236/F258)", () => {
    const { container } = renderHelp();
    fireEvent.click(screen.getByRole("button", { name: "I was charged too much" }));
    const text = container.querySelector("#help-problem-charged-too-much")?.textContent ?? "";
    expect(text).toContain("a one-time $2 account setup fee");
    expect(text).not.toContain("a one-time account setup fee");
  });

  it("the FAQ answers cancelling, a no-show, and says what the cancellation rate on a profile means", () => {
    const questions = FAQ_SECTIONS.flatMap((s) => s.items.map((i) => i.q));
    expect(questions).toContain("How do I cancel a job?");
    expect(questions).toContain("What if my Helpr doesn't show up?");
    expect(questions).toContain("What does the cancellation rate on a profile mean?");
    expect(questions).not.toContain("What is the cancellation rate?");
  });
});
