/**
 * Owner, 2026-10-08 (Q1558): "Should have all the same positioning, box sizes.
 * These should be nearly identical" and "make sure the icon matches that page".
 * Messages drew a sienna line-art envelope while My Posts / My Jobs drew a
 * circle with a Send / Wrench glyph.
 *
 * The class: every main-tab empty page is the shared EmptyState circle with
 * that tab's OWN nav icon (navIconFor), and none draws an illustration instead.
 *
 * @mutate src/components/job-card/ActivityEmptyState.tsx |   const Icon = navIconFor(isPosted ? "/posts" : "/jobs"); |   const Icon = navIconFor("/home");
 * @mutate src/components/messages/ConversationList.tsx |                 icon={navIconFor("/messages")} |                 icon={navIconFor("/home")}
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("every main-tab empty page wears its own nav icon in the shared circle", () => {
  it("My Posts / My Jobs: the page's nav icon", () => {
    expect(src("src/components/job-card/ActivityEmptyState.tsx")).toMatch(/const Icon = navIconFor\(isPosted \? "\/posts" : "\/jobs"\);/);
  });
  it("Messages: the Messages nav icon, and no illustration in its place", () => {
    const s = src("src/components/messages/ConversationList.tsx");
    const block = s.slice(s.indexOf('title="No messages yet"') - 400, s.indexOf('title="No messages yet"'));
    expect(block).toMatch(/icon=\{navIconFor\("\/messages"\)\}/);
    expect(block).not.toMatch(/illustration=/);
  });
});
