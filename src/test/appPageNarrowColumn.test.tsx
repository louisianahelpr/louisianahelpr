/**
 * Deep audit 11-22 #47: Declutter's Sell screens (/declutter/sell, ?mode=choose, the step form, Set up selling) were a
 * 576px column hugging the left with ~568px of blank space beside it at 1440. A one-column form now asks the shared
 * shell for it (AppPage `narrow`): the title row and the content are ONE centered max-w-xl column.
 * CLASS: no screen rendering <AppPage> sets its own left-hugging max-w-xl..7xl column inside it (one with no mx-auto; it
 * passes `narrow` instead), so no screen drifts back to a column stuck to the left. Inventory: every tracked file under src/ that renders <AppPage.
 *
 * @mutate src/components/AppPage.tsx |   const body = narrow ? <div className="mx-auto w-full max-w-xl" data-app-page-narrow="">{tabBody}</div> : tabBody; |   const body = narrow ? <div className="w-full max-w-xl" data-app-page-narrow="">{tabBody}</div> : tabBody;
 * @mutate src/components/declutter/DeclutterSellChooser.tsx | phoneHidesTitle narrow> | phoneHidesTitle>
 * @mutate src/components/declutter/SellerSetup.tsx | <AppPage title="Sell" backTo="/declutter?tab=selling" narrow> | <AppPage title="Sell" backTo="/declutter?tab=selling">
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { blankComments } from "./helpers/blankNonCode";
import { trackedFiles } from "./helpers/trackedFiles";

vi.mock("@/hooks/useGuestPublicFrame", () => ({ useGuestPublicFrame: () => false }));

import AppPage from "@/components/AppPage";

const ROOT = resolve(__dirname, "..", "..");
const files = trackedFiles("src")
  .filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f) && f !== "src/components/AppPage.tsx");

describe("#47: a one-column form is one centered column of the shared shell", () => {
  it("AppPage narrow centers the title row and the content in one max-w-xl column", () => {
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><AppPage title="Sell" narrow><p>Form</p></AppPage></MemoryRouter></QueryClientProvider>);
    const col = document.querySelector("[data-app-page-narrow]") as HTMLElement;
    expect(col.className.split(/\s+/)).toEqual(expect.arrayContaining(["mx-auto", "w-full", "max-w-xl"]));
    expect(col.contains(screen.getByRole("heading", { name: "Sell" }))).toBe(true);
    expect(col.contains(screen.getByText("Form"))).toBe(true);
  });

  it("no AppPage screen hand-sets its own narrow column; the Sell screens pass narrow", () => {
    const pages = files.filter((f) => /<AppPage\b/.test(blankComments(readFileSync(resolve(ROOT, f), "utf8"))));
    expect(pages.length).toBeGreaterThan(10);
    const leftHugging = (src: string) => [...src.matchAll(/className="([^"]*)"/g)].some((m) => /\bw-full max-w-(?:[2-7]?xl)\b/.test(m[1]) && !/\bmx-auto\b/.test(m[1]));
    const own = pages.filter((f) => leftHugging(blankComments(readFileSync(resolve(ROOT, f), "utf8"))));
    expect(own).toEqual([]);
    for (const f of ["src/components/declutter/SellOneScreen.tsx", "src/components/declutter/DeclutterSellView.tsx", "src/components/declutter/DeclutterSellChooser.tsx", "src/components/declutter/SellerSetup.tsx"]) {
      // Screenshot check of #47 (11-22, 1440): the "couldn't load your selling settings" state still spread full width.
      // EVERY state of a Sell screen (error, under-age, already listed) sits in the same column, not only the form.
      const tags = [...blankComments(readFileSync(resolve(ROOT, f), "utf8")).matchAll(/<AppPage\b[^>]*>/g)].map((m) => m[0]);
      expect(tags.length, f).toBeGreaterThan(0);
      expect(tags.filter((t) => !/\bnarrow\b/.test(t)), f).toEqual([]);
    }
  });
});
