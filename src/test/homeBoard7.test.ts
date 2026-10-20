/**
 * Home = board 7 (owner-approved 2026-10-20), restyle only:
 *   - Next up names the to-do's section (icon + name) top right, and its row is
 *     dots (+ See all) left, the ONE action right;
 *   - Coming up sits ABOVE the section tiles, each row a section icon in a
 *     tinted circle + "<your side> · <when>" ("You hired" / "You're working");
 *   - no price on a Coming up job row (rust is money only; the board shows none).
 *
 * @mutate src/pages/home/HomeDashboard.tsx | export const COMING_UP_ROLE: Record<ComingUpItem["role"], string> = { posted: "You hired", working: "You're working" }; | export const COMING_UP_ROLE: Record<ComingUpItem["role"], string> = { posted: "Posted", working: "Applied" };
 * @mutate src/pages/home/HomeDashboard.tsx | meta={<span data-coming-up-role={c.role}>{[COMING_UP_ROLE[c.role], whenLine(c.job)].filter(Boolean).join(" · ")}</span>} | meta={whenLine(c.job)}
 * @mutate src/pages/home/HomeDashboard.tsx |                   onClick={() => navigate(`/jobs/${c.job.id}`)}\n |                   onClick={() => navigate(`/jobs/${c.job.id}`)}\n                  right={<span className="text-ds-15 font-bold shrink-0">${c.job.budget}</span>}\n
 * @mutate src/pages/home/HomeDashboard.tsx | <span data-testid="next-up-section" | <span data-testid="next-up-section" hidden
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { COMING_UP_ROLE } from "@/pages/home/HomeDashboard";

const src = blankComments(readFileSync(resolve(__dirname, "../pages/home/HomeDashboard.tsx"), "utf8"));

describe("Home matches board 7", () => {
  it("is not vacuous", () => {
    expect(src.length).toBeGreaterThan(4000);
    expect(src).toContain('data-testid="next-up"');
  });

  it("each Coming up row says which side you are on, with the section icon, and no price", () => {
    expect(COMING_UP_ROLE).toEqual({ posted: "You hired", working: "You're working" });
    const block = src.slice(src.indexOf('<GroupSection title="Coming up">'), src.indexOf('aria-label="Your sections"'));
    expect(block.length).toBeGreaterThan(300);
    expect(block).toContain("data-coming-up-role={c.role}");
    expect(block).toContain("COMING_UP_ROLE[c.role]");
    expect(block).toMatch(/leading=\{\s*<span aria-hidden className="w-10 h-10 shrink-0 rounded-full/);
    expect(block).not.toMatch(/budget|right=\{/);
  });

  it("Next up names its section, top right", () => {
    expect(src).not.toMatch(/<span data-testid="next-up-section" hidden/);
    expect(src).toMatch(/<span data-testid="next-up-section"[^>]*>\s*<Icon/);
  });
});
