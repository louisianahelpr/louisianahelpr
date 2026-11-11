/**
 * Whole-app audit 11-10, Builder 2, F464 Settings > Report a bug: the page was titled Report a bug but opened on the
 * full support form with a seven-topic dropdown. Opened with ?topic=report the topic is now one line
 * ("Topic: Something's not working") with a "Not a bug? Change topic" button that brings the dropdown back; opened
 * any other way (no topic, another topic) the dropdown shows as before.
 *
 * @mutate src/components/profile/SupportInline.tsx | useState(() => searchParams.get("topic") === "report") | useState(false)
 * @mutate src/components/profile/SupportInline.tsx | onClick={() => setTopicCollapsed(false)} data-support-change-topic="" | data-support-change-topic=""
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";

describe("F464: Report a bug hides the topic dropdown behind 'Not a bug? Change topic'", () => {
  it("collapses only for ?topic=report, shows the chosen topic, and the button restores the dropdown", () => {
    const src = blankComments(readFileSync("src/components/profile/SupportInline.tsx", "utf8"));
    expect(src).toContain('const [topicCollapsed, setTopicCollapsed] = useState(() => searchParams.get("topic") === "report");');
    const start = src.indexOf("{topicCollapsed ? (");
    expect(start).toBeGreaterThan(0);
    const collapsed = src.slice(start, src.indexOf(") : (", start));
    expect(collapsed).toContain('data-support-topic-collapsed=""');
    expect(collapsed).toContain("{selected.label}");
    expect(collapsed).toMatch(/onClick=\{\(\) => setTopicCollapsed\(false\)\} data-support-change-topic="">\s*Not a bug\? Change topic/);
    // The dropdown is the other branch of the same conditional, not gone.
    expect(src.slice(start)).toContain('<SelectTrigger id="support-reason"');
  });
});
