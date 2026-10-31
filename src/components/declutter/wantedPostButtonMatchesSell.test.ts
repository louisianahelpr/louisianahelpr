/**
 * LEAD-WANTED-POST-BUTTON (owner 2026-10-31): Declutter > Wanted's "Post what you're looking for" was a centered pill
 * floating under the tabs. It is the same button as Selling's "Sell an item": the default Button with the same classes,
 * left-aligned in a row like Selling's. Measured b18 10-31 (headless Chromium, mocked Supabase): at 375 it was x=47
 * h=48 (centered BarkPillButton), now x=20 h=56 16px, the same as Sell an item (x=20 h=56 16px).
 *
 * @mutate src/components/declutter/DeclutterWantedViews.tsx |         <div className="flex items-center gap-3" data-wanted-post=""> |         <div className="flex justify-center" data-wanted-post="">
 * @mutate src/components/declutter/DeclutterWantedViews.tsx |           <Button type="button" className="shrink-0 rounded-full" onClick={() => setPosting(true)}> |           <Button type="button" className="shrink-0 rounded-full px-8" onClick={() => setPosting(true)}>
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

const read = (f: string) => blankComments(readFileSync(join(process.cwd(), "src/components/declutter", f), "utf8"));

describe("LEAD-WANTED-POST-BUTTON: Wanted's post button is Selling's Sell an item button", () => {
  it("same Button classes and the same left-aligned row", () => {
    const selling = read("DeclutterHomeView.tsx").match(/<div className="([^"]*)" data-selling-sell="">\s*<Button asChild className="([^"]*)">/);
    expect(selling, "Selling's Sell an item row").toBeTruthy();
    const wanted = read("DeclutterWantedViews.tsx").match(/<div className="([^"]*)" data-wanted-post="">\s*<Button type="button" className="([^"]*)" onClick=\{\(\) => setPosting\(true\)\}>/);
    expect(wanted, "Wanted's post row").toBeTruthy();
    expect(wanted![2]).toBe(selling![2]);
    // The same row, but for when it shows: Selling's is off on a phone and on desktop (LEAD-SELLING-NO-SELL-BTN-PHONE).
    const layout = (c: string) => c.split(/\s+/).filter((x) => !["hidden", "flex", "sm:flex", "lg:hidden"].includes(x)).sort();
    expect(layout(wanted![1])).toEqual(layout(selling![1]));
    expect(wanted![1].split(/\s+/)).toContain("flex");
    const raw = readFileSync(join(process.cwd(), "src/components/declutter/DeclutterWantedViews.tsx"), "utf8");
    expect(raw).toMatch(/onClick=\{\(\) => setPosting\(true\)\}>Post what you're looking for<\/Button>/);
    expect(raw).not.toMatch(/<BarkPillButton[^>]*>Post what you're looking for/);
  });
});
