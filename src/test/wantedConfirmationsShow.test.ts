/**
 * toastPolicy suppresses toast.success and toast.info: code that uses them for a member's confirmation shows nothing, and
 * reads as if it does (Builder 45 found the same on Buy now in preview). The Wanted screens and their admin panel say what
 * happened with the bare toast(), which always renders.
 *
 * @mutate src/components/declutter/DeclutterWantedReplies.tsx |       toast("Blocked. You won't see each other's Wanted posts."); |       toast.success("Blocked. You won't see each other's Wanted posts.");
 * @mutate src/components/declutter/DeclutterWantedViews.tsx |     if (held) toast("Your post is up. | if (held) toast.info("Your post is up.
 * @mutate src/components/admin/adminReports/WantedReportPanel.tsx |       toast(done); |       toast.success(done);
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const FILES = ["src/components/declutter/DeclutterWantedViews.tsx", "src/components/declutter/DeclutterWantedReplies.tsx", "src/components/admin/adminReports/WantedReportPanel.tsx"];
const code = (f: string) => blankComments(readFileSync(resolve(__dirname, "../..", f), "utf8"));

describe("Wanted confirmations are shown", () => {
  it("reads the screens (floor)", () => {
    expect(FILES.flatMap((f) => code(f).match(/\btoast\(/g) ?? []).length).toBeGreaterThan(5);
  });
  it.each(FILES)("%s uses no suppressed toast", (f) => {
    expect(code(f).match(/\btoast\.(success|info|message)\(/g) ?? []).toEqual([]);
  });
});
