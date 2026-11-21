/**
 * Owner 11-21 on the public /browse page: "needs a back button to the left of browse jobs", then "just name it jobs not
 * browse jobs". The web page's PublicHeaderPage header now carries the shared BackButton FIRST on the title's row
 * (PageHeader's own back slot, the same pattern as Declutter's guest page: src/test/declutterGuestHomeLinks1120.test.tsx),
 * named "Go to Home", always to "/", and the title is "Jobs" (nav.jobs, as the native branch's AppTopBar says). Its
 * loading frame (GuestBrowseSkeleton) and the raw-HTML first paint (browseShellCards.mjs) hold the arrow's box and say
 * "Jobs", so nothing moves when the page lands.
 *
 * @mutate src/pages/home/DashboardGuest.tsx |       onBack={goHome}\n      backLabel={tr("nav.goHome")} |       hideBack
 * @mutate src/pages/home/DashboardGuest.tsx |   const goHome = () => navigate("/"); |   const goHome = () => navigate(-1);
 * @mutate src/pages/home/DashboardGuest.tsx |     <PublicHeaderPage\n      title={tr("nav.jobs")} |     <PublicHeaderPage\n      title="Browse jobs"
 * @mutate src/components/marketing/PublicHeaderPage.tsx |       onBack={onBack}\n | \n
 * @mutate src/components/PageHeader.tsx | <BackButton onClick={onBack} to={backTo} label={backLabel} /> | <BackButton onClick={onBack} to={backTo} />
 * @mutate src/components/BackButton.tsx |       {...(label ? { "aria-label": label } : {})}\n | \n
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/components/marketing/PublicLayout", () => ({ default: ({ children }: { children: ReactNode }) => <div data-frame="public">{children}</div> }));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => false }));

const { PublicHeaderPage } = await import("@/components/marketing/PublicHeaderPage");
const { browseShellHtml } = await import("@/lib/browseShellCards.mjs");

afterEach(cleanup);

const read = (p: string) => blankComments(readFileSync(p, "utf8"));
const guest = read("src/pages/home/DashboardGuest.tsx");
/** The web branch's PublicHeaderPage element, from its opening tag to its first `>` line. */
const webHeader = /<PublicHeaderPage\n([\s\S]*?)\n    >/.exec(guest)?.[1] ?? "";

describe("/browse: a back arrow left of the title, and the title is Jobs", () => {
  it("the web page passes the title Jobs, an always-Home back with its name, and no hideBack", () => {
    expect(webHeader.length).toBeGreaterThan(40);
    expect(webHeader).toContain('title={tr("nav.jobs")}');
    expect(webHeader).toContain("onBack={goHome}");
    expect(guest).toContain('const goHome = () => navigate("/");');
    expect(webHeader).toContain('backLabel={tr("nav.goHome")}');
    expect(webHeader).not.toMatch(/\bhideBack\b/);
    expect(guest).not.toContain("Browse jobs");
  });

  it("PublicHeaderPage draws the arrow first on the title's row, named, and it runs the page's own back", async () => {
    const onBack = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/legal", "/browse"]} initialIndex={1}>
        <Routes>
          <Route path="/" element={<p>landing page</p>} />
          <Route path="/legal" element={<p>legal page</p>} />
          <Route path="/browse" element={<PublicHeaderPage title="Jobs" bottomPaddingClassName="pb-4" onBack={onBack} backLabel="Go to Home"><p>cards</p></PublicHeaderPage>} />
        </Routes>
      </MemoryRouter>
      </QueryClientProvider>,
    );
    const heading = screen.getByRole("heading", { level: 1, name: "Jobs" });
    const back = screen.getByRole("button", { name: "Go to Home" });
    const row = heading.parentElement!.parentElement!;
    expect(row.className.split(/\s+/)).toEqual(expect.arrayContaining(["flex", "items-center", "gap-3"]));
    expect(row.firstElementChild!.contains(back)).toBe(true);
    expect(back.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // onBack wins over history (the in-app history here would have gone back to /legal).
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("legal page")).toBeNull();
  });

  it("the loading frame and the raw-HTML first paint hold the arrow's box and say Jobs", () => {
    const skel = read("src/components/GuestBrowseSkeleton.tsx");
    expect(skel).toContain('<PageHeader title={t("nav.jobs")} hideBack reserveBackSlot width="public" topInsetHandled />');
    const html = browseShellHtml([{ title: "Mow the front yard", category: "yard_work", budget: 85, location: "Lafayette, LA", status: "open", created_at: "2026-10-31T12:00:00Z" }], Date.parse("2026-11-01T12:00:00Z"), { src: "/e.webp", srcset: "/e.webp 96w" });
    expect(html).toMatch(/<div class="flex items-center gap-3"><div class="shrink-0" aria-hidden="true"><span class="w-11 h-11 -ml-2 [^"]*"[^>]*><svg[^>]*lucide-arrow-left[\s\S]*?<\/span><\/div><div class="flex flex-col leading-none min-w-0"><h1 class="text-page-title leading-tight truncate">Jobs<\/h1>/);
    expect(html).not.toContain("Browse jobs");
  });
});
