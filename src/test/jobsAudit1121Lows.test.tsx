/**
 * Jobs audit 11-21 (public + poster), the Low and Suggestion findings fixed together. Each block names its finding.
 * (P18 and P28 are driven in src/test/guestOpensSharedJobLink.test.tsx; S32 in src/test/taxKindOnlyWhereAsked.test.tsx;
 * P15 in src/pages/search/searchRanksAndMatchesBrowse1121.test.tsx.)
 *
 * P27: login walls for /tips and /quotes (reached from a member's own notifications) led with Create an account,
 * /posts said the generic line, and every notice wore a clock.
 * @mutate src/pages/auth/loginNotice.ts |   ["/quotes", "Log in to see your quote."], |
 * @mutate src/pages/auth/loginNotice.ts |   ["/posts", "Your posts need an account."], |
 * @mutate src/pages/auth/loginNotice.ts |   const timedOut = notice === SESSION_LOST_NOTICE \|\| notice === INACTIVITY_NOTICE; |   const timedOut = notice !== null;
 *
 * P18 and P28 (a stale link leads with open jobs; Sign up keeps ?ref=share): mutations in guestOpensSharedJobLink.test.tsx.
 *
 * P29: closing the guest job sheet left focus on <body>: the guest card was a bare div (not focusable, no keyboard).
 * @mutate src/components/dashboard/jobCardInteractiveProps.ts | ? (e: MouseEvent<HTMLElement>) => { e.currentTarget.focus({ preventScroll: true }); hapticLight(); onSelect(job); } | ? () => { hapticLight(); onSelect(job); }
 * @mutate src/components/dashboard/jobCardInteractiveProps.ts |     role: "button" as const,\n    tabIndex: 0, |     ...(isGuest ? {} : { role: "button" as const, tabIndex: 0 }),
 *
 * P16: the discovery pages' load errors were three different things (a red line, a generic card, a centred card that
 * said "Pull down to refresh, or tap Try again" on desktop web).
 * @mutate src/pages/search/SearchPage.tsx |           <ErrorState\n            variant="inline"\n            title={t("srch.failed")} |           <ErrorState\n            title={t("srch.failed")}
 * @mutate src/pages/helprs/FindHelprs.tsx | <ErrorState variant="inline" title={w("pub.helprs.loadFailed", "We couldn't load Helprs.")} | <ErrorState variant="inline"
 * @mutate src/pages/home/DashboardGuest.tsx |             body={wordInLang("pub.retryBody", "Try again. If it sticks, our end is having a hiccup, not yours.")} |             body="Pull down to refresh, or tap Try again."
 *
 * P20: one member was "ET" on /user and "EH" on Home: five screens built initials by hand from the first two words.
 * @mutate src/pages/user/UserProfile.tsx |   const initials = avatarInitials(profile.full_name); |   const initials = (profile.full_name \|\| "").split(/\s+/).filter(Boolean).map((w) => w[0]).join("").toUpperCase().slice(0, 2) \|\| "?";
 * @mutate src/pages/user/UserProfile.tsx | it wraps instead.\n          wrapTitle={isOwnProfile} | it wraps instead.
 *
 * P30: /hire's two calls wrapped unevenly at 375 (the primary alone on row 2).
 * @mutate src/pages/info/HireTownPage.tsx | <div className="flex flex-col-reverse gap-3 sm:flex-row sm:flex-wrap" data-town-ctas=""> | <div className="flex flex-wrap gap-3" data-town-ctas="">
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";
import { avatarInitials } from "@/lib/avatarImage";
import { gatedPageNotice, loginNotice } from "@/pages/auth/loginNotice";
import { useGuestJobSheet } from "@/pages/home/useGuestJobSheet";
import { GuestJobPreview } from "@/components/dashboard/GuestJobPreview";
import { jobCardInteractiveProps } from "@/components/dashboard/jobCardInteractiveProps";
import type { EnrichedJob } from "@/components/dashboard/types";

vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeDollars: () => 0, useFirstPayoutFeeCents: () => 0 }));

const src = (p: string) => blankComments(readFileSync(p, "utf8"));

describe("P27: login walls name the page and lead the right way", () => {
  const base = { oauthError: null, connect: null, signedOutForInactivity: false, arrivedFromSignup: false, bouncedFromGatedRoute: true };
  it("/tips and /quotes are a member's own links: Log in leads, no Create an account", () => {
    for (const [path, line] of [["/tips/abc", "Log in to send your tip."], ["/quotes/request/abc", "Log in to see your quote."], ["/quotes/send/abc", "Log in to see your quote."]] as const) {
      const n = loginNotice({ ...base, redirect: path });
      expect(n.notice, path).toBe(`${line} We'll take you straight back to it.`);
      expect(n.leadWithSignup, path).toBe(false);
    }
  });
  it("/posts names itself", () => {
    expect(gatedPageNotice("/posts")).toBe("Your posts need an account. Create an account, or log in and we'll take you straight back to it.");
  });
  it("only the two signed-out lines wear the clock", () => {
    expect(loginNotice({ ...base, redirect: "/posts" }).timedOut).toBe(false);
    expect(loginNotice({ ...base, bouncedFromGatedRoute: false, signedOutForInactivity: true }).timedOut).toBe(true);
    expect(loginNotice({ ...base, sessionLost: true, redirect: "/jobs" }).timedOut).toBe(true);
    expect(src("src/pages/auth/Login.tsx")).toMatch(/timedOut \? \(\s*<Clock[^]*?\) : \(\s*<Info /);
  });
});

describe("P29: the guest job sheet hands focus back to the card", () => {
  const JOB = { id: "j1", title: "Mow the lawn", category: "yard_work", location: "Lafayette, LA", budget: 60 } as unknown as EnrichedJob;
  function Board() {
    const { detailJob, openDetailJob, closeDetailJob } = useGuestJobSheet([JOB]);
    const card = jobCardInteractiveProps({ isGuest: true, job: JOB, onSelect: openDetailJob, handleTap: () => {}, prefetchHandlers: {} as never });
    return (
      <>
        <div {...card}>Mow the lawn card</div>
        {detailJob && <GuestJobPreview job={detailJob} onClose={closeDetailJob} onSignUp={() => {}} />}
      </>
    );
  }
  it("the guest card is a focusable button that opens with Enter", () => {
    render(<MemoryRouter initialEntries={["/browse"]}><Board /></MemoryRouter>);
    const card = screen.getByRole("button", { name: "Mow the lawn card" });
    expect(card.tabIndex).toBe(0);
    fireEvent.keyDown(card, { key: "Enter" });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
  it("tapping the card (no focus from the browser, as in WebKit) and pressing Esc puts focus back on it", async () => {
    render(<MemoryRouter initialEntries={["/browse"]}><Board /></MemoryRouter>);
    const card = screen.getByRole("button", { name: "Mow the lawn card" });
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(card);
    const dialog = await screen.findByRole("dialog");
    expect(document.activeElement).not.toBe(card);
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(card));
  });
  it("the guest card says what a tap does, like the member card", () => {
    expect(src("src/components/dashboard/JobCard.tsx")).toContain('<span className="sr-only">View </span>');
  });
});

describe("P16: one load-error card on every discovery page", () => {
  // The discovery pages a guest or member browses from (audit 11-21 public area).
  const PAGES = ["src/pages/home/DashboardGuest.tsx", "src/pages/helprs/FindHelprs.tsx", "src/pages/search/SearchPage.tsx", "src/pages/u/PublicProfilePage.tsx", "src/pages/jobs/JobDetail.tsx"];
  it("each draws ErrorState inline with a title naming what did not load, and no pull/tap words", () => {
    expect(PAGES.length).toBeGreaterThan(4);
    for (const f of PAGES) {
      const s = src(f);
      const cards = [...s.matchAll(/<ErrorState\b[^>]*?(?:\/>|>)/g)].map((m) => m[0]);
      expect(cards.length, f).toBeGreaterThan(0);
      for (const c of cards) {
        expect(c, f).toMatch(/variant="inline"/);
        expect(c, f).toMatch(/\btitle=/);
      }
      expect(s, f).not.toMatch(/Pull down to refresh, or tap/);
    }
    expect(src("src/pages/search/SearchPage.tsx")).not.toMatch(/role="alert"[^>]*>\s*<p[^>]*>\{t\("srch\.failed"\)\}/);
  });
});

describe("P20: one rule for a member's initials", () => {
  // Shop names (a logo square from a business name's first two words) are not a person's initials.
  const SHOP_LOGO_FILE = "src/pages/info/giftGuides/SmallBizLocal.tsx";
  it("no screen builds initials by hand; avatarInitials is the one rule (first and last word)", () => {
    const files = execFileSync("git", ["ls-files", "src/**/*.ts", "src/**/*.tsx"], { encoding: "utf8" }).split("\n")
      .filter((f) => f && !/\.test\.tsx?$/.test(f) && !f.startsWith("src/test/"));
    expect(files.length).toBeGreaterThan(500);
    const handRolled = files.filter((f) => f !== SHOP_LOGO_FILE && existsSync(f) && /\.map\(\(?\w+\)? => \w+\[0\]\)\s*\.join\(""\)\s*\.toUpperCase\(\)/.test(src(f)));
    expect(handRolled).toEqual([]);
    expect(avatarInitials("Eli Tester Hart")).toBe("EH");
    for (const f of ["src/pages/user/UserProfile.tsx", "src/pages/profile/Profile.tsx", "src/components/ChatPresence.tsx", "src/components/dashboard/JobPosterCard.tsx", "src/pages/posts/postedJobs/applicantsPanel/applicantsPanelHelpers.ts"]) {
      expect(src(f), f).toContain("avatarInitials(");
    }
  });
  it("the own /user title wraps instead of ending in an ellipsis at 375", () => {
    const s = src("src/pages/user/UserProfile.tsx");
    expect((s.match(/wrapTitle=\{isOwnProfile\}/g) ?? []).length).toBe(3);
    expect(src("src/pages/user/UserProfileLoadingBody.tsx")).toContain("wrapTitle={own}");
  });
});

describe("P30: /hire's calls stack on a phone with the primary on top", () => {
  it("column-reverse under sm keeps the primary last in the DOM (right of the pair from sm) and first on screen", () => {
    const s = src("src/pages/info/HireTownPage.tsx");
    expect(s).toContain('<div className="flex flex-col-reverse gap-3 sm:flex-row sm:flex-wrap" data-town-ctas="">');
    expect((s.match(/className="rounded-full w-full sm:w-auto"/g) ?? []).length).toBe(2);
  });
});

