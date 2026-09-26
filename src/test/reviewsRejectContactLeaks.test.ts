/**
 * TS-010: the contact-leak gate covered chat, jobs, bios and applications but
 * not reviews, which are public on the reviewee's profile. The newest
 * migration defining reject_contact_leak_in_review must scan BOTH public text
 * columns and attach on insert and on edits of either; both review clients
 * must show the server's check_violation copy instead of a generic retry.
 *
 * @mutate supabase/migrations/20260924063123_reviews_reject_contact_leaks.sql | v_reason := public.contact_leak_reason(NEW.feedback);  -- TS-010 feedback scan | v_reason := NULL;
 * @mutate supabase/migrations/20260924063123_reviews_reject_contact_leaks.sql | v_reason := public.contact_leak_reason(NEW.response_text);  -- TS-010 reply scan | v_reason := NULL;
 * @mutate supabase/migrations/20260924063123_reviews_reject_contact_leaks.sql | BEFORE INSERT OR UPDATE OF feedback, response_text ON public.reviews | BEFORE UPDATE OF feedback ON public.reviews
 * @mutate src/components/CompletionPrompts.tsx | else if (error.code === "23514" && error.message) { hapticError(); toast.error(userFacingError(error, "We couldn't submit your review — please try again.")); } // server contact-leak refusal (TS-010) | else if (false) {}
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DIR = "supabase/migrations";
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const defining = files.filter((f) =>
  readFileSync(`${DIR}/${f}`, "utf8").includes("FUNCTION public.reject_contact_leak_in_review("),
);
const newest = defining.length ? readFileSync(`${DIR}/${defining[defining.length - 1]}`, "utf8") : "";

describe("reviews are behind the contact-leak gate (TS-010)", () => {
  it("the migration inventory is real", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(defining.length).toBeGreaterThan(0);
  });
  it("both public text columns are scanned", () => {
    expect(newest).toMatch(/v_reason := public\.contact_leak_reason\(NEW\.feedback\);/);
    expect(newest).toMatch(/v_reason := public\.contact_leak_reason\(NEW\.response_text\);/);
  });
  it("the trigger fires on insert and on edits of either column", () => {
    expect(newest).toMatch(/BEFORE INSERT OR UPDATE OF feedback, response_text ON public\.reviews/);
  });
  it("both review clients surface the refusal copy", () => {
    expect(readFileSync("src/components/CompletionPrompts.tsx", "utf8")).toMatch(/error\.code === "23514" && error\.message\) \{ hapticError\(\); toast\.error\(userFacingError\(error, /);
    expect(readFileSync("src/components/reviewPanel/ReviewForm.tsx", "utf8")).toMatch(/error\?\.code === "23514"/);
  });
});
