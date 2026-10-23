/**
 * CLASS CHECK: ONE header row (owner, 2026-10-21). On the desktop website a
 * page's back arrow, title and actions sit IN the global top bar, left of the
 * bell and photo, never on a second row under it; on a phone a page keeps one
 * row. The shared piece is PageTitleBar (src/components/header/PageTitleBar.tsx):
 * DesktopTopNav registers the slot, and every signed-in page header goes
 * through it (PageHeader for every sub-screen, Profile tab and AppPage;
 * AppTopBar for the sections; Home's greeting).
 *
 * INVENTORY (from source, comments blanked): every non-test file under src/
 * that writes an `<h1`. Each must be in HEADER_H1 (it IS the shared row, or its
 * phone form) or NOT_A_PAGE_HEADER (with why). EXACT, both ways: a new page
 * that hand-rolls its own title row fails here until it uses PageTitleBar.
 *
 * @mutate src/components/DesktopTopNav.tsx | <div ref={registerDesktopTitleSlot} data-desktop-title-slot="" | <div data-desktop-title-slot=""
 * @mutate src/components/PageHeader.tsx |     <PageTitleBar\n      title={title} |     <PageTitleBarX\n      title={title}
 * @mutate src/components/sections/AppTopBar.tsx |     <PageTitleBar\n      title={title ?? ""} |     <PageTitleBarX\n      title={title ?? ""}
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "..", "..");
const code = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));

/** The shared row, and the phone forms it hands back unchanged. */
const HEADER_H1: Record<string, string> = {
  "src/components/header/PageTitleBar.tsx": "THE row: drawn in the desktop bar",
  "src/components/PageHeader.tsx": "the sub-screen row's phone form, passed to PageTitleBar as `phone`",
  "src/components/sections/AppTopBar.tsx": "the section row's phone form, passed to PageTitleBar as `phone`",
  "src/pages/home/HomeDashboard.tsx": "Home's greeting's phone form, passed to PageTitleBar as `phone`",
};

/** Files with an h1 that is not a signed-in page's header row. EXACT. */
const NOT_A_PAGE_HEADER: Record<string, string> = {
  "src/components/AppLockGate.tsx": "the app-lock screen (Face ID), shown before any page",
  "src/components/ForceUpdateGate.tsx": "the update-required screen, outside the router",
  "src/components/JobsSectionSkeleton.tsx": "sr-only heading of a loading skeleton",
  "src/components/LoginRouteSkeleton.tsx": "the sign-in screen's loading skeleton (signed out)",
  "src/components/admin/AdminSectionHeader.tsx": "admin console (its own shell, no desktop top bar)",
  "src/components/admin/dashboard/DashboardHome.tsx": "admin console (its own shell, no desktop top bar)",
  "src/components/auth/AuthCardHead.tsx": "signed-out auth card",
  "src/components/auth/AuthShell.tsx": "signed-out / account-state card (AuthShell)",
  "src/components/dashboard/BrowseTasksToolbar.tsx": "sr-only heading of the Browse feed's collapsed toolbar",
  "src/components/dashboard/DashboardBlockedScreen.tsx": "a blocked-account screen in place of the page",
  "src/components/firstRun/FirstRun.tsx": "the first-run welcome moment, full screen",
  "src/components/landing/HeroSection.tsx": "the signed-out landing hero (locked)",
  "src/components/messages/ChatView.tsx": "sr-only conversation heading (the chat's visible title is ChatHeader's name pill)",
  "src/components/profile/SupportInline.tsx": "a 'Message sent' confirmation moment, not the page row",
  "src/components/ui/ScreenHeaderRow.tsx": "toolbar row whose title is sr-only on the desktop website (titleSrOnly); phone headers are AppTopBar",
  "src/pages/auth/AccountBanned.tsx": "account-state screen (AuthShell)",
  "src/components/auth/Under13Blocked.tsx": "account-state screen (AuthShell): the under-13 block, Q1803",
  "src/pages/auth/CompleteProfile.tsx": "signup completion (auth flow)",
  "src/pages/auth/Login.tsx": "signed out",
  "src/pages/auth/Unsubscribe.tsx": "email unsubscribe landing (signed out)",
  "src/pages/auth/signup/SignupStep1.tsx": "signed out",
  "src/pages/info/NotFound.tsx": "404 moment",
  "src/prerender/staticPages.tsx": "build-time static markup of /terms/full, /privacy/full, /sms-opt-in for readers with no JavaScript (api/share puts it in #root; React replaces it on boot); the live page uses PageHeader",
  "src/pages/jobs/JobDetail.tsx": "sr-only heading of the shared job page",
  "src/pages/post-job/PaymentSuccess.tsx": "the payment-confirmed celebration moment",
};

const files = execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith("src/test/"));
const withH1 = files.filter((f) => /<h1[\s>]/.test(code(f))).sort();

describe("ONE header row: every signed-in page header goes through PageTitleBar (owner 2026-10-21)", () => {
  it("reads the real tree (not vacuous)", () => {
    expect(files.length).toBeGreaterThan(800);
    expect(withH1.length).toBeGreaterThan(10);
  });

  it("the desktop bar registers the slot, and the shared headers render through PageTitleBar", () => {
    expect(code("src/components/DesktopTopNav.tsx")).toMatch(/ref=\{registerDesktopTitleSlot\}/);
    for (const f of ["src/components/PageHeader.tsx", "src/components/sections/AppTopBar.tsx", "src/pages/home/HomeDashboard.tsx"]) {
      expect(code(f), f).toMatch(/<PageTitleBar\b[\s\S]*?phone=\{/);
    }
  });

  it("every h1 is the shared row or listed with why it is not a page header (exact, both ways)", () => {
    const listed = { ...HEADER_H1, ...NOT_A_PAGE_HEADER };
    expect(withH1.filter((f) => !(f in listed)), "a page hand-rolls an h1 title row: use PageTitleBar (via PageHeader / AppTopBar)").toEqual([]);
    expect(Object.keys(listed).filter((f) => !withH1.includes(f)), "stale entry: remove it").toEqual([]);
  });
});
