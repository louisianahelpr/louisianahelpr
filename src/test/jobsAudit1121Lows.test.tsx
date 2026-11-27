/**
 * Jobs audit 11-21 (public + poster), the Low and Suggestion findings fixed together. Each block names its finding.
 * (P18 and P28 are driven in src/test/guestOpensSharedJobLink.test.tsx; S32 in src/test/taxKindOnlyWhereAsked.test.tsx;
 * P15 in src/pages/search/searchRanksAndMatchesBrowse1121.test.tsx.)
 *
 * P27: login walls for /tips and /quotes (reached from a member's own notifications) led with Create an account,
 * /posts said the generic line, and every notice wore a clock.
 * @mutate src/pages/auth/loginNotice.ts |   ["/quotes", "Log in to see your quote."], |
 * @mutate src/pages/auth/loginNotice.ts |   ["/posts", "Log in to see your posts."], |
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
 * P23: mid-scroll the back arrow went away (/helprs: title-only compact bar; /user: the whole header scrolled off).
 * @mutate src/pages/helprs/FindHelprs.tsx | title={w("pub.helprs.title", "Find a Helpr")} stickyHeader onBack= | title={w("pub.helprs.title", "Find a Helpr")} onBack=
 * @mutate src/pages/user/UserProfile.tsx | <div className="max-sm:sticky max-sm:top-0 max-sm:z-40 max-sm:bg-[hsl(var(--background))]" data-user-header-pinned=""> | <div data-user-header-pinned="">
 *
 * P25: a Group job read "Budget of $0 will be split: at least $0 per Helpr." before a price; a guest's draft card asked
 * them to add a video again (guests cannot add one).
 * @mutate src/components/postjob/GroupJobCard.tsx |       {budgetNum > 0 && (\n        <p className="text-ds-11 text-muted-foreground" data-crew-split=""> |       {true && (\n        <p className="text-ds-11 text-muted-foreground" data-crew-split="">
 * @mutate src/pages/post-job/EntryChoice.tsx | t(form.isGuest ? "postJob.draftBodyGuest" : "postJob.draftBody") | t("postJob.draftBody")
 *
 * L28 (poster): "Why?" alone on the stalled job's chip.
 * @mutate src/pages/posts/postedJobCard/steps/InProgressStep.tsx |             label="What happens next?" |             label="Why?"
 *
 * P26: guest Post a job showed the full marketing footer under every step, and no step indicator at 1440 on its first
 * screen (the desktop rail is not on that screen; the phone bar was lg:hidden).
 * @mutate src/components/marketing/GuestPublicFrame.tsx |   const footerReady = contentShown && !focused; |   const footerReady = contentShown;
 * @mutate src/pages/post-job/PostJob.tsx | onBack={form.handlePostJobBack} focusedFlow> | onBack={form.handlePostJobBack}>
 * @mutate src/components/postjob/PostJobStepHeader.tsx | className={`flex items-center gap-3${barAtEveryWidth ? "" : " lg:hidden"}`} | className="flex items-center gap-3 lg:hidden"
 * @mutate src/pages/post-job/EntryChoice.tsx | helper={head.h} barAtEveryWidth /> | helper={head.h} />
 *
 * S33: /helprs at 1440: 25 chips in three rows, 30 cards with two buttons each (60) and no "more".
 * @mutate src/pages/helprs/FindHelprs.tsx | {q.data.helprs.slice(0, shownHelprs).map((h) => { | {q.data.helprs.map((h) => {
 * @mutate src/pages/helprs/FindHelprs.tsx | const folded = !allSkills && i > SKILL_CHIPS_FIRST && !on; | const folded = false;
 *
 * G20 (poster): on a screen with no dock the toast sat flush on the bottom edge, over the pay button.
 * @mutate src/components/ui/sonner.tsx | var(--bottom-nav-h, 96px), var(${STICKY_ACTION_H_VAR}, 0px)) + 12px)`; | var(--bottom-nav-h, 96px), var(${STICKY_ACTION_H_VAR}, 0px)))`;
 *
 * S34: a guest on a shared job's page had no way to share it on.
 * @mutate src/components/dashboard/GuestJobPage.tsx |         <div className="flex justify-center" data-guest-share="">\n          <ShareJobButton | <div className="flex justify-center" data-guest-share="">\n          <span
 *
 * S35: /book's "This Helpr isn't available" offered only "Go home".
 * @mutate src/components/profile/PublicProfileForward.tsx | <Link to="/helprs" data-book-find-helpr="">Find a Helpr</Link> | <Link to="/" data-book-find-helpr="">Go home</Link>
 *
 * L25 (poster): the urgent bonus and the applicant sort showed "selected" as a white pill; every other switch is olive.
 * @mutate src/components/postjob/BudgetSection.tsx |               ariaLabel={tr("postJob.f.urgentBonus")}\n |               ariaLabel={tr("postJob.f.urgentBonus")}\n              tone="quiet"\n
 * @mutate src/pages/posts/postedJobs/applicantsPanel/ApplicantSortControls.tsx |       ariaLabel="Sort applicants by"\n |       ariaLabel="Sort applicants by"\n      tone="quiet"\n
 *
 * L27 (poster): the private note had no label or placeholder and said nothing about being private.
 * @mutate src/pages/posts/postedJobs/applicantsPanel/ApplicantPrivateNote.tsx | <label htmlFor={noteId} className="block text-ds-12 font-semibold text-foreground">Private note: only you see this</label> | <span />
 *
 * L36 (poster): Saved Helprs used a star for "jobs together" and said "Last 3 hours ago".
 * @mutate src/components/profile/savedHelpersTab/SavedHelperCard.tsx |                   Last job {formatDistanceToNow( |                   Last {formatDistanceToNow(
 *
 * L30 (poster): /payment-success at 1440 sat on grey blobs (AuthShell's ambient wash); the app is white.
 * @mutate src/pages/post-job/PaymentSuccess.tsx | centerColumn maxWidth="md" plainBackground> | centerColumn maxWidth="md">
 * @mutate src/components/auth/AuthShell.tsx |       {(desktopBrandPanel \|\| centerColumn) && !plainBackground && ( |       {(desktopBrandPanel \|\| centerColumn) && (
 *
 * L32 (poster): the AI builder's failure toast said "or start from a blank form" with no way to.
 * @mutate src/components/postjob/AiJobBuilder.tsx |       if (onBlankForm && !busy) toast.error(message, { action: { label: "Start from a blank form", onClick: onBlankForm } }); |       if (false) toast.error(message);
 * @mutate src/pages/post-job/EntryChoice.tsx |             onBlankForm={() => form.setEntryPanel(null)}\n |
 *
 * L33 (poster): an empty start time rested on "12 : 00" with neither AM nor PM picked, reading as a time.
 * @mutate src/components/TimePickerWheel.tsx |       {!hasValue && !awaitingPeriod && ( |       {false && (
 *
 * L34 (poster): quote cards drew a blank grey circle for a quoter with no photo; "Past work photos 0 0 0" took a row.
 * @mutate src/pages/quotes/QuoteRequestPage.tsx | <UserAvatar userId={quote.quoter_id} src={quote.quoter_avatar_url} name={formatName(quote.quoter_name, "A member")} pixelSize={40} aria-hidden className="h-10 w-10 shrink-0" /> | <span aria-hidden className="h-10 w-10 shrink-0 rounded-full bg-muted" data-x={quote.quoter_id} />
 * @mutate src/components/quotes/QuotesSideBySide.tsx |             {live.some((q) => (q.photo_paths ?? []).length > 0) && ( |             {true && (
 *
 * L35 (poster): /jobs/settings rows ran ~1600px wide at 1920.
 * @mutate src/pages/jobs/JobsSettings.tsx | <div className="space-y-4 pb-6 max-w-3xl" data-testid="jobs-settings"> | <div className="space-y-4 pb-6" data-testid="jobs-settings">
 *
 * S39: Post a job's first screen stretched 1152px at 1440.
 * @mutate src/pages/post-job/EntryChoice.tsx | const ENTRY_COLUMN = "flex flex-col gap-3 lg:max-w-3xl"; | const ENTRY_COLUMN = "flex flex-col gap-3";
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
import { enPostJob } from "@/lib/i18n/enPostJob";
import { PostJobStepHeader } from "@/components/postjob/PostJobStepHeader";
import { GuestJobPage } from "@/components/dashboard/GuestJobPage";
import { TimePickerWheel } from "@/components/TimePickerWheel";
import { QuotesSideBySide } from "@/components/quotes/QuotesSideBySide";
import { ApplicantPrivateNote } from "@/pages/posts/postedJobs/applicantsPanel/ApplicantPrivateNote";
import type { GuestJob } from "@/components/dashboard/GuestJobPreview";
import { gatedPageNotice, loginNotice } from "@/pages/auth/loginNotice";
import { useGuestJobSheet } from "@/pages/home/useGuestJobSheet";
import { GuestJobPreview } from "@/components/dashboard/GuestJobPreview";
import { jobCardInteractiveProps } from "@/components/dashboard/jobCardInteractiveProps";
import type { EnrichedJob } from "@/components/dashboard/types";

vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeDollars: () => 0, useFirstPayoutFeeCents: () => 0 }));

// jsdom has no Element.scrollTo (the time wheels centre their row on mount).
if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};

const src = (p: string) => blankComments(readFileSync(p, "utf8"));

describe("P27: login walls name the page and lead the right way", () => {
  const base = { oauthError: null, connect: null, signedOutForInactivity: false, arrivedFromSignup: false, bouncedFromGatedRoute: true };
  it("/tips and /quotes are a member's own links: Log in leads, no Create an account", () => {
    for (const [path, line] of [["/tips/abc", "Log in to send your tip."], ["/quotes/request/abc", "Log in to see your quote."], ["/quotes/send/abc", "Log in to see your quote."]] as const) {
      const n = loginNotice({ ...base, redirect: path });
      expect(n.notice, path).toBe(line);
    }
  });
  it("/posts names itself", () => {
    expect(gatedPageNotice("/posts")).toBe("Log in to see your posts.");
  });
  it("only the two signed-out lines wear the clock", () => {
    expect(loginNotice({ ...base, redirect: "/posts" }).timedOut).toBe(false);
    expect(loginNotice({ ...base, bouncedFromGatedRoute: false, signedOutForInactivity: true }).timedOut).toBe(true);
    expect(loginNotice({ ...base, sessionLost: true, redirect: "/jobs" }).timedOut).toBe(true);
    // Polish audit 11-27 #4: the notice is a plain grey line with no icon; timedOut only names its kind.
    expect(src("src/pages/auth/Login.tsx")).toContain('data-login-notice-kind={oauthError ? "error" : timedOut ? "timed-out" : "info"}');
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
    await waitFor(() => {
      expect(document.activeElement).toBe(card);
      expect(screen.queryByRole("dialog")).toBeNull();
    });
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

describe("P23: the way back stays on screen while the page scrolls", () => {
  it("/helprs pins its title row (back + title), not the title-only bar", () => {
    expect(src("src/pages/helprs/FindHelprs.tsx")).toMatch(/<AppPage title=\{w\("pub\.helprs\.title", "Find a Helpr"\)\} stickyHeader /);
  });
  it("/user's header (back, save, menu) is pinned on a phone", () => {
    const s = src("src/pages/user/UserProfile.tsx");
    const at = s.indexOf('data-user-header-pinned=""');
    expect(at).toBeGreaterThan(0);
    const open = s.lastIndexOf("<div", at);
    expect(s.slice(open, at)).toContain("max-sm:sticky max-sm:top-0 max-sm:z-40 max-sm:bg-[hsl(var(--background))]");
    // The pinned box holds the loaded page's header (the one with the back, save and menu actions).
    expect(s.slice(at, at + 3000)).toMatch(/<PageHeader[\s\S]*?titleActions=\{/);
  });
});

describe("P25 / L28: Post a job and job-page copy", () => {
  it("the crew split line waits for a price; a guest's draft card never mentions video", () => {
    const g = src("src/components/postjob/GroupJobCard.tsx");
    expect(g).toMatch(/\{budgetNum > 0 && \(\s*<p[^>]*data-crew-split=""/);
    expect(src("src/pages/post-job/EntryChoice.tsx")).toContain('t(form.isGuest ? "postJob.draftBodyGuest" : "postJob.draftBody")');
    expect(enPostJob["postJob.draftBodyGuest"]).not.toMatch(/video/i);
  });
  it("the stalled job's chip says what it opens", () => {
    const s = src("src/pages/posts/postedJobCard/steps/InProgressStep.tsx");
    expect(s).toContain('label="What happens next?"');
    expect(s).not.toMatch(/label="Why\?"/);
  });
});

describe("P26: guest Post a job is a focused flow with a step indicator at every width", () => {
  it("the guest frame drops the footer for a focused flow, and Post a job is one", () => {
    expect(src("src/components/marketing/GuestPublicFrame.tsx")).toContain("const footerReady = contentShown && !focused;");
    expect(src("src/components/AppPage.tsx")).toContain("<GuestPublicFrame focused={focusedFlow}>");
    expect(src("src/pages/post-job/PostJob.tsx")).toMatch(/<AppPage title=\{header\.title\} onBack=\{form\.handlePostJobBack\} focusedFlow>/);
  });
  it("the first screen (no desktop rail) keeps the step bar at every width; form screens keep it phone-only", () => {
    const groups = render(<MemoryRouter><PostJobStepHeader screen="groups" question="Q" helper="H" barAtEveryWidth /></MemoryRouter>);
    expect(groups.container.querySelector("[data-step-bar]")!.className).not.toContain("lg:hidden");
    groups.unmount();
    const form = render(<MemoryRouter><PostJobStepHeader screen="details" question="Q" helper="H" /></MemoryRouter>);
    expect(form.container.querySelector("[data-step-bar]")!.className).toContain("lg:hidden");
    form.unmount();
    expect((src("src/pages/post-job/EntryChoice.tsx").match(/<PostJobStepHeader screen="groups"[^>]*barAtEveryWidth \/>/g) ?? []).length).toBe(2);
  });
});

describe("S33: a calmer /helprs on desktop", () => {
  it("the list pages at 12, desktop folds the skills behind More skills, and a card has one button", () => {
    const s = src("src/pages/helprs/FindHelprs.tsx");
    expect(s).toContain("const HELPRS_PAGE = 12;");
    expect(s).toContain("{q.data.helprs.slice(0, shownHelprs).map((h) => {");
    expect(s).toContain('data-more-helprs=""');
    expect(s).toMatch(/const folded = !allSkills && i > SKILL_CHIPS_FIRST && !on;/);
    expect(s).toContain('data-more-skills=""');
    // The photo and name link to the profile; the card's only button is Offer a job.
    expect(s).not.toContain('"pub.helprs.viewProfile"');
  });
});

describe("G20: a phone toast never sits on the bottom edge", () => {
  it("the phone bottom offset adds 12px over the dock height (0 where there is no dock)", () => {
    const s = src("src/components/ui/sonner.tsx");
    expect(s).toMatch(/mobileOffset=\{\{[\s\S]*?bottom: TOAST_PHONE_BOTTOM,/);
    const m = s.match(/const TOAST_PHONE_BOTTOM = `([^`]+)`/);
    expect(m).toBeTruthy();
    // Deep audit 11-22 #13: the dock or a sticky bottom bar, whichever is taller, then the 12px.
    expect(m![1]).toBe("calc(max(var(--safe-area-bottom, 0px) + var(--bottom-nav-h, 96px), var(${STICKY_ACTION_H_VAR}, 0px)) + 12px)");
  });
});

describe("S34: a guest can share the job from its page", () => {
  it("the guest job page carries the shared Share button with the job's own link", () => {
    const job = { id: "3f0c9a4e-0000-4000-8000-000000000000", title: "Mow the lawn", category: "yard_work", location: "Lafayette, LA", budget: 60 } as unknown as GuestJob;
    render(<MemoryRouter><GuestJobPage job={job} onSignUp={() => {}} onLogIn={() => {}} onBrowse={() => {}} /></MemoryRouter>);
    const slot = document.querySelector("[data-guest-share]")!;
    expect(slot).toBeTruthy();
    // "Share" where the device has a share sheet, "Copy link" elsewhere (jsdom); the same component either way.
    expect(slot.querySelector("button")?.textContent ?? "").toMatch(/^(Share|Copy link)$/);
  });
});

describe("S35: an unavailable /book link offers another Helpr", () => {
  it("Find a Helpr leads, Go home stays", () => {
    const s = src("src/components/profile/PublicProfileForward.tsx");
    expect(s).toContain('<Link to="/helprs" data-book-find-helpr="">Find a Helpr</Link>');
    expect(s).toContain('<Link to={user ? "/home" : "/"}>Go home</Link>');
  });
});

describe("L25 / L27 / L36: poster-side controls", () => {
  it("the urgent bonus and the applicant sort wear the solid selected tone", () => {
    expect(src("src/components/postjob/BudgetSection.tsx")).not.toMatch(/ariaLabel=\{tr\("postJob\.f\.urgentBonus"\)\}\s*tone="quiet"/);
    expect(src("src/pages/posts/postedJobs/applicantsPanel/ApplicantSortControls.tsx")).not.toContain('tone="quiet"');
  });
  it("the private note is labelled as private, with a placeholder, and saves with the shared Button", () => {
    render(<ApplicantPrivateNote editing note="" draft="" setDraft={() => {}} onSave={() => {}} onCancel={() => {}} onEdit={() => {}} />);
    const box = screen.getByLabelText("Private note: only you see this");
    expect(box.getAttribute("placeholder")).toMatch(/^e\.g\./);
    expect(screen.getByRole("button", { name: "Save" }).className).toMatch(/rounded/);
  });
  it("Saved Helprs: a briefcase for jobs together, and 'Last job'", () => {
    const s = src("src/components/profile/savedHelpersTab/SavedHelperCard.tsx");
    expect(s).toContain('<Briefcase className="w-3 h-3" aria-hidden />');
    expect(s).toContain("Last job {formatDistanceToNow(");
    expect(s).not.toMatch(/<Star className="w-3 h-3 fill-primary" \/>/);
  });
});

describe("L30: /payment-success is a plain white page at every width", () => {
  it("AuthShell's wash is off for it", () => {
    expect(src("src/pages/post-job/PaymentSuccess.tsx")).toContain('<AuthShell hideBack hideHeader centerColumn maxWidth="md" plainBackground>');
    expect(src("src/components/auth/AuthShell.tsx")).toContain("{(desktopBrandPanel || centerColumn) && !plainBackground && (");
  });
});

describe("L32: the AI builder's failure toast offers the blank form it names", () => {
  it("the toast carries a Start from a blank form action, wired to Post a job's first screen", () => {
    expect(src("src/components/postjob/AiJobBuilder.tsx")).toContain('{ action: { label: "Start from a blank form", onClick: onBlankForm } }');
    expect(src("src/pages/post-job/EntryChoice.tsx")).toContain("onBlankForm={() => form.setEntryPanel(null)}");
  });
});

describe("L33: an empty time picker says nothing is picked", () => {
  it("empty: 'No time picked yet'; with a time: no such line", () => {
    const empty = render(<TimePickerWheel value="" onChange={() => {}} variant="wheels" />);
    expect(screen.getByTestId("time-pick-empty").textContent).toBe("No time picked yet");
    empty.unmount();
    render(<TimePickerWheel value="09:00" onChange={() => {}} variant="wheels" />);
    expect(screen.queryByTestId("time-pick-empty")).toBeNull();
  });
});

describe("L34: quote cards and the side-by-side table", () => {
  it("a quoter with no photo gets the shared initials avatar; a photos row with only zeros is left out", () => {
    expect(src("src/pages/quotes/QuoteRequestPage.tsx")).toMatch(/<UserAvatar userId=\{quote\.quoter_id\} src=\{quote\.quoter_avatar_url\}/);
    const q = (id: string, photos: string[]) => ({ id, quoter_id: `u-${id}`, quoter_name: "Dana Lee", quoter_avatar_url: null, price_cents: 25000, note: "n", available_note: "Sat", photo_paths: photos, status: "pending", respond_until: null }) as never;
    const none = render(<QuotesSideBySide quotes={[q("a", []), q("b", [])]} />);
    expect(none.container.querySelector("[data-quotes-photos-row]")).toBeNull();
    none.unmount();
    const some = render(<QuotesSideBySide quotes={[q("a", ["u/quotes/x.jpg"]), q("b", [])]} />);
    expect(some.container.querySelector("[data-quotes-photos-row]")).not.toBeNull();
  });
});

describe("L35: Jobs settings keeps a reading column on very wide screens", () => {
  it("the settings list is capped at max-w-3xl", () => {
    expect(src("src/pages/jobs/JobsSettings.tsx")).toContain('<div className="space-y-4 pb-6 max-w-3xl" data-testid="jobs-settings">');
  });
});

describe("S39: Post a job's first screen keeps a reading column on desktop", () => {
  it("the entry and its loading bones share a 768px column", () => {
    const s = src("src/pages/post-job/EntryChoice.tsx");
    expect(s).toContain('const ENTRY_COLUMN = "flex flex-col gap-3 lg:max-w-3xl";');
    expect((s.match(/<div className=\{ENTRY_COLUMN\}>/g) ?? []).length).toBe(2);
  });
});

describe("P30: /hire's calls stack on a phone with the primary on top", () => {
  it("column-reverse under sm keeps the primary last in the DOM (right of the pair from sm) and first on screen", () => {
    const s = src("src/pages/info/HireTownPage.tsx");
    expect(s).toContain('<div className="flex flex-col-reverse gap-3 sm:flex-row sm:flex-wrap" data-town-ctas="">');
    expect((s.match(/className="rounded-full w-full sm:w-auto"/g) ?? []).length).toBe(2);
  });
});

