/**
 * Audit 2026-10-21 batch 3 (SHELL): #60 the reviews count says reviews, not
 * "completed jobs"; #61/#18 buttons and page titles sentence case
 * ("Browse jobs"). Empty-state titles keep Montserrat (lead ruling on #61).
 *
 * @mutate src/components/profile/ReviewsTab.tsx |               review{reviewCount !== 1 ? "s" : ""} |               completed job{reviewCount !== 1 ? "s" : ""}
 * @mutate src/lib/i18n/enScreens.ts | "chat.browseJobs": "Browse jobs" | "chat.browseJobs": "Browse Jobs"
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "..", "..");
const read = (f: string) => blankComments(readFileSync(join(ROOT, f), "utf8"));

describe("audit batch 3 SHELL fixes", () => {
  it("#60 counts reviews as reviews", () => {
    const s = read("src/components/profile/ReviewsTab.tsx");
    expect(s).toMatch(/review\{reviewCount !== 1 \? "s" : ""\}/);
    expect(s).not.toMatch(/Based on|completed job\{/);
  });
  it("#61 'Browse jobs' is sentence case wherever it is a control or title", () => {
    for (const f of ["src/components/messages/ConversationList.tsx", "src/lib/i18n/enScreens.ts", "src/pages/home/DashboardGuest.tsx", "src/components/GuestBrowseSkeleton.tsx"]) {
      expect(read(f), f).not.toMatch(/Browse Jobs/);
    }
  });
});
