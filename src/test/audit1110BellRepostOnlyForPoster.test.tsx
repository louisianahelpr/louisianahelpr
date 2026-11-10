/**
 * Whole-app audit 11-10, Builder 2 easy batch.
 *
 * F486: the bell's "Repost" pill went to anyone whose `warning` row had "cancelled" in its title, a poster-only
 * action handed to the Helpr of a Declutter seller-fault cancel ("Job cancelled" via declutter_notify to helper_id),
 * to a seller ("Order cancelled", "Preorder cancelled") and to a buyer ("Custom order cancelled"). Repost now
 * reaches only the rows that only ever reach the poster; the rest get "View" when they know where to go.
 * F240: the sponsor thank-you offered "Add to calendar" with no date to add when the brand chose "Any day".
 * F260t: the hire town page's "See Helprs in <town>" read as plain text; it is the secondary button it always was.
 * F485: Delete account sat 4px under Log out; a divider and 32px keep a thumb meant for Log out off it.
 *
 * @mutate src/components/notificationPanel/quickActions.ts |   if (n.title === "Your Helpr cancelled" \|\| n.message.toLowerCase().includes("auto-cancel")) { |   if (n.type === "warning" \|\| n.title === "Your Helpr cancelled" \|\| n.message.toLowerCase().includes("auto-cancel")) {
 * @mutate src/components/notificationPanel/quickActions.ts |   if (n.type === "warning" \|\| n.type === "job_update") { |   if (n.type === "job_update") {
 * @mutate src/components/NotificationPanelView.tsx |                               const action = quickActionFor(n, destinationOf); |                               const action = n.type === "expired" ? { label: "Repost", href: "/post-job" } : null;
 * @mutate src/components/sponsor/ClaimSection.tsx |           {done.anyDay ? null : ( |           {false ? null : (
 * @mutate src/pages/info/HireTownPage.tsx |           <Button asChild variant="outline" size="sm" className="squircle"> |           <p className="text-ds-15">
 * @mutate src/components/profile/profileLanding/YouMenu.tsx |         <div className="mt-8 border-t border-border pt-4" data-delete-account-apart=""> |         <div data-delete-account-apart="">
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { blankComments } from "@/test/helpers/blankNonCode";
import { quickActionFor } from "@/components/notificationPanel/quickActions";

const ROOT = resolve(__dirname, "../..");
const src = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));
const toJob = () => "/jobs/j1";
const nowhere = () => null;
const row = (type: string, title: string, message: string) => ({ type, title, message });

describe("F486: the bell's Repost pill reaches only the poster", () => {
  it("the rows that only the poster gets keep Repost", () => {
    expect(quickActionFor(row("expired", "Listing expired", '"Rake" expired.'), toJob)).toEqual({ label: "Repost", href: "/post-job" });
    expect(quickActionFor(row("job_updates", "Your Helpr cancelled", '"Rake": your Helpr cancelled.'), toJob)).toEqual({ label: "Repost", href: "/post-job" });
    expect(quickActionFor(row("warning", "Your Helpr cancelled", '"Rake": your Helpr cancelled.'), toJob)).toEqual({ label: "Repost", href: "/post-job" });
    expect(quickActionFor(row("job_updates", "Job auto-cancelled", '"Rake" was auto-cancelled: nobody was hired.'), toJob)).toEqual({ label: "Repost", href: "/post-job" });
  });

  it("a Helpr's, seller's or buyer's warning cancel row gets View, never Repost", () => {
    const theirs = [
      // declutter_notify(j.helper_id, 'warning', 'Job cancelled', ...) in 20261109211412
      row("warning", "Job cancelled", '"Pickup for Hallie" was cancelled: on the Declutter order it was booked for, the seller did not show.'),
      row("warning", "Order cancelled", "Your order for \"Lamp\" was cancelled."),
      row("warning", "Preorder cancelled", "The preorder for \"Lamp\" was cancelled."),
      row("warning", "Custom order cancelled", "Your custom order was cancelled."),
      // notify_on_job_update's Helpr copy (helprCancelCopy.ts)
      row("warning", "Job cancelled", '"Move a dresser" was cancelled by our team.'),
    ];
    for (const n of theirs) {
      expect(quickActionFor(n, toJob), n.title).toEqual({ label: "View", href: "/jobs/j1" });
      expect(quickActionFor(n, nowhere), n.title).toBeNull();
    }
  });

  it("a job_update that mentions a cancel still gets View; quiet rows get nothing", () => {
    expect(quickActionFor(row("job_update", "Update", "The job was cancelled."), toJob)).toEqual({ label: "View", href: "/jobs/j1" });
    expect(quickActionFor(row("message", "New message", "hi"), toJob)).toBeNull();
    expect(quickActionFor(row("warning", "Payment failed", "Your card was declined."), toJob)).toBeNull();
  });

  it("the panel picks its pill through quickActionFor", () => {
    const panel = src("src/components/NotificationPanelView.tsx");
    expect(panel).toContain("const action = quickActionFor(n, destinationOf);");
    expect(panel).not.toMatch(/label: "Repost"/);
  });
});

describe("F240: no Add to calendar for a brand that chose Any day", () => {
  it("the thank-you link is gated on done.anyDay", () => {
    const s = src("src/components/sponsor/ClaimSection.tsx");
    const i = s.indexOf("{done.anyDay ? null : (");
    expect(i).toBeGreaterThan(0);
    expect(s.slice(i, i + 400)).toContain("C.thankYou.addToCalendar");
  });
});

describe("F260t: See Helprs in <town> is a secondary button", () => {
  it("renders as an outline Button that is still the link", async () => {
    vi.doMock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ gate: (_k: string, f: () => void) => f, gatedProps: () => ({}) }) }));
    vi.doMock("@/hooks/usePageMeta", () => ({ usePageMeta: () => {} }));
    vi.doMock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: null, profile: null, isLoading: false }) }));
    vi.doMock("@/components/marketing/PublicHeaderPage", () => ({ PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
    const { default: HireTownPage } = await import("@/pages/info/HireTownPage");
    render(
      <MemoryRouter initialEntries={["/hire/yard-work/new-iberia"]}>
        <Routes><Route path="/hire/:service/:town" element={<HireTownPage />} /></Routes>
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "See Helprs in New Iberia" });
    expect(link).toHaveAttribute("href", "/helprs?town=New%20Iberia");
    expect(link.className).toMatch(/\bborder\b|outline/);
    expect(link.className).not.toContain("link-standard");
  });
});

describe("F485: Delete account sits apart from Log out", () => {
  it("a divider and top margin wrap the Delete button, which itself stays a quiet text button", () => {
    const s = src("src/components/profile/profileLanding/YouMenu.tsx");
    const wrap = s.indexOf('data-delete-account-apart=""');
    expect(wrap).toBeGreaterThan(0);
    const openTag = s.slice(s.lastIndexOf("<div", wrap), s.indexOf(">", wrap));
    expect(openTag).toMatch(/\bmt-8\b/);
    expect(openTag).toMatch(/\bborder-t\b/);
    expect(openTag).toMatch(/\bpt-4\b/);
    const del = s.slice(wrap, s.indexOf("Delete account", wrap));
    expect(del).toContain('data-testid="profile-delete-account"');
  });
});
