/**
 * Design audit Area 03 (Jobs, poster side, 11-18), pass 2. ~/.lh-shots/design-audit-areas/03-jobs-poster/FINDINGS.md.
 *
 * L9  Post a job's category search: "wash" found only Pressure washing; a car wash or the laundry are asks too.
 * L10 The saved-Helpr picker on Post a job's start screen said "Loading your saved Helprs…" for ever when its read
 *     failed; it says it failed and offers Try again.
 * L12 The crew roster's buttons sit side by side in one full-width row under the name, never a right-hugging column.
 * L16 "Payouts set up" shows on your own profile only (it told a poster weighing a hire nothing). "Worked together" was
 *     checked: it counts the pair's COMPLETED, non-seed jobs (workedTogetherCountsCompleted.test.ts), so a seed Helpr
 *     with only seed or unfinished hires reads 0 by design.
 * L8  Template tiles draw their category's line icon (owner 11-09, F113), never the sample's emoji.
 * H4  The Helpr Guarantee card and the job page person card's name in Spanish too.
 * M11 is held by moreMenuFitsItsList / moreActionsPanelFits (the card's More is the job page's bottom sheet).
 *
 * @mutate src/components/postjob/JobCategoryGroups.tsx |   [/\b(?:wash(?:ing)?\|laundry\|ironing\|dishes)\b/, ["cleaning", "errands"]], |   [/\bzzzz\b/, ["cleaning"]],
 * @mutate src/components/postjob/JobCategoryGroups.tsx |   [/\b(?:car\|truck\|boat)\s*wash\|\bdetail(?:ing)?\b/, ["cleaning", "auto_repair"]], |   [/\bzzzy\b/, ["cleaning"]],
 * @mutate src/pages/post-job/OfferToSavedHelpr.tsx | {!helpers && isError ? ( | {false ? (
 * @mutate src/components/GroupJobHelpers.tsx | <div className="flex w-full min-w-0 basis-full items-center gap-2 [&>[data-job-action-chip]]:min-w-0 [&>[data-job-action-chip]]:flex-1" data-crew-actions=""> | <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2" data-crew-actions="">
 * @mutate src/pages/user/UserProfileMasthead.tsx | payoutsSetUp={isOwnProfile && (profile | payoutsSetUp={(profile
 * @mutate src/pages/post-job/EntryChoice.tsx | <CategoryIcon category={sample.category} aria-hidden className="h-4 w-4" /> | {sample.icon}
 * @mutate src/components/guarantee/HelprGuaranteePanel.tsx | {by ? t("gu.tellBy", { when: laWhen(by) }) : t("gu.tellWithin")} {t("gu.explain")} | Not done right? Tell us within 48 hours of the job being done.
 * @mutate src/components/guarantee/HelprGuaranteePanel.tsx |   return <p className="flex items-center gap-2 text-ds-15 font-semibold"><ShieldCheck className="h-4 w-4 text-primary" aria-hidden />{t("gu.title")}</p>; |   return <p className="flex items-center gap-2 text-ds-15 font-semibold"><ShieldCheck className="h-4 w-4 text-primary" aria-hidden />Helpr Guarantee</p>;
 * @mutate src/pages/jobs/jobPage/JobPageParts.tsx | <DeclutterSellerCard sellerId={helprId} noun="Helpr" seeLabel={t("jobPage.seeHelpr")} /> | <DeclutterSellerCard sellerId={helprId} noun="Helpr" />
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";

vi.mock("@/components/SuggestCategory", () => ({ SuggestCategory: () => null }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, loading: false }) }));
const rpc = vi.hoisted(() => ({ fail: true }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async () => (rpc.fail ? { data: null, error: { message: "boom", code: "500" } } : { data: [], error: null }),
  },
}));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/hooks/useProofPhotoUrls", () => ({ useProofPhotoUrls: (v: string[]) => v.map(() => null) }));
vi.mock("@/lib/guarantee", async (orig) => ({
  ...(await orig<typeof import("@/lib/guarantee")>()),
  fetchGuaranteeClaim: async () => null,
}));

import { JobCategoryGroups } from "@/components/postjob/JobCategoryGroups";
import { OfferToSavedHelpr } from "@/pages/post-job/OfferToSavedHelpr";
import { HelprGuaranteePanel } from "@/components/guarantee/HelprGuaranteePanel";

const read = (f: string) => blankComments(readFileSync(join(process.cwd(), f), "utf8"));
const qc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

afterEach(() => { cleanup(); __resetLangForTests(); });

describe("Area 03 pass 2 (design audit 11-18)", () => {
  it("L9: 'wash' offers Cleaning and Errands beside Pressure washing; 'car wash' offers Auto & small engine", () => {
    render(<JobCategoryGroups category="" setCategory={vi.fn()} group={null} setGroup={vi.fn()} onPicked={vi.fn()} />);
    const box = screen.getByRole("searchbox") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "wash" } });
    const names = () => screen.getAllByRole("button").map((b) => b.textContent ?? "");
    expect(names().length).toBeGreaterThan(2);
    for (const want of ["Pressure washing", "Cleaning", "Errands"]) expect(names().some((n) => n.includes(want)), want).toBe(true);
    fireEvent.change(box, { target: { value: "car wash" } });
    expect(names().some((n) => n.includes("Auto & small engine"))).toBe(true);
    fireEvent.change(box, { target: { value: "laundry" } });
    expect(names().some((n) => n.includes("Cleaning"))).toBe(true);
  });

  it("L10: a failed saved-Helpr read says so and offers Try again, never 'Loading…' for ever", async () => {
    rpc.fail = true;
    render(
      <QueryClientProvider client={qc()}>
        <MemoryRouter><OfferToSavedHelpr open onOpenChange={vi.fn()} headless /></MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText("We couldn't load your saved Helprs.")).toBeTruthy());
    expect(screen.queryByText(/Loading your saved Helprs/)).toBeNull();
    rpc.fail = false;
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    await waitFor(() => expect(screen.queryByText("We couldn't load your saved Helprs.")).toBeNull());
  });

  it("L12: the crew's buttons are one full-width row, side by side in equal parts", () => {
    const src = read("src/components/GroupJobHelpers.tsx");
    const row = /<div className="([^"]+)" data-crew-actions="">/.exec(src)?.[1].split(/\s+/) ?? [];
    expect(row.length).toBeGreaterThan(3);
    expect(row).toContain("basis-full");
    expect(row).toContain("[&>[data-job-action-chip]]:flex-1");
    expect(row).not.toContain("justify-end");
    expect(row).not.toContain("flex-wrap");
  });

  it("L16: 'Payouts set up' only on your own profile; 'Worked together' counts completed non-seed jobs", () => {
    const masthead = read("src/pages/user/UserProfileMasthead.tsx");
    expect(masthead.length).toBeGreaterThan(1000);
    expect(masthead).toMatch(/payoutsSetUp=\{isOwnProfile && \(profile/);
    const hook = read("src/pages/user/useUserProfileData.ts");
    expect(hook).toMatch(/\.filter\(\(j\) => j\.status === "completed" && j\.is_seed !== true\)\.length/);
  });

  it("L8: a template tile draws its category's line icon, never the sample's emoji", () => {
    const src = read("src/pages/post-job/EntryChoice.tsx");
    const tile = /data-template-icon=""[\s\S]*?<\/span>/.exec(src)?.[0] ?? "";
    expect(tile.length).toBeGreaterThan(20);
    expect(tile).toMatch(/<CategoryIcon category=\{sample\.category\}/);
    expect(src).not.toMatch(/\{sample\.icon\}/);
  });

  it("H4: the Helpr Guarantee card in Spanish", async () => {
    setLang("es");
    await ensureLangLoaded();
    const { container } = render(
      <QueryClientProvider client={qc()}>
        <HelprGuaranteePanel job={{ id: "j1", customer_id: "me", helper_id: "h1", status: "in_progress", payment_status: "escrow", is_group_job: false, helper_completed_at: null, poster_completed_at: null } as never} userId="me" side="poster" />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(container.querySelector("[data-guarantee-explainer]")).not.toBeNull());
    const text = container.textContent ?? "";
    expect(text).toContain("Garantía Helpr");
    expect(text).toContain("¿No quedó bien?");
    expect(text).not.toMatch(/Helpr Guarantee|Not done right/);
  });

  it("H4: the job page's person cards are named in the reader's language", () => {
    const parts = read("src/pages/jobs/jobPage/JobPageParts.tsx");
    expect(parts).toMatch(/noun="Helpr" seeLabel=\{t\("jobPage\.seeHelpr"\)\}/);
    expect(parts).toMatch(/noun="poster" seeLabel=\{t\("jobPage\.seePoster"\)\}/);
    const card = read("src/components/declutter/DeclutterSellerCard.tsx");
    expect(card).toMatch(/<span className="sr-only">\{see\}, <\/span>/);
  });
});
