import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The blocked-storage boot repair (index.html) has been silently deleted
 * TWICE — once by a commit staged from a stale base that reverted 161 lines
 * with no mention of index.html in its message, and it is exactly the kind
 * of change a future "clean up index.html" pass could plausibly strip again,
 * since it looks like inert boilerplate to a reader who hasn't hit the bug.
 *
 * This does not re-run the actual repro (that needs a real browser with
 * `localStorage` throwing — see the Playwright probe used to verify the fix
 * originally). It asserts the one thing a silent deletion would change: the
 * shim's marker text is present in the shipped HTML, BEFORE any other
 * script tag that could touch storage. If this goes red, someone removed
 * the repair — restore it, don't relax this assertion.
 */
describe("index.html blocked-storage boot repair", () => {
  const html = readFileSync(resolve(__dirname, "../../index.html"), "utf8");

  it("is present", () => {
    expect(html).toContain("BLOCKED-STORAGE REPAIR");
    expect(html).toContain("__helpr_boot_storage_probe__");
  });

  it("runs before every other inline or module script", () => {
    const repairMarkerIndex = html.indexOf("__helpr_boot_storage_probe__");
    expect(repairMarkerIndex).toBeGreaterThan(-1);
    // The repair's OWN <script> tag start — everything strictly before this
    // is a candidate for "runs before the repair"; the repair script itself
    // legitimately touches localStorage and is excluded.
    const repairTagStart = html.lastIndexOf("<script", repairMarkerIndex);

    const scriptTags = [...html.matchAll(/<script\b[^>]*>/g)];
    let checked = 0;
    for (const match of scriptTags) {
      const tagStart = match.index ?? -1;
      if (tagStart >= repairTagStart) continue;
      const tagEnd = html.indexOf("</script>", tagStart);
      const body = html.slice(tagStart, tagEnd);
      checked += 1;
      expect(
        body,
        `A <script> tag before the storage repair references localStorage: ${body.slice(0, 120)}`,
      ).not.toMatch(/\blocalStorage\b/);
    }
    // Fails loudly rather than passing vacuously if the JSON-LD blocks this
    // assumes exist ever move or get removed.
    expect(checked, "no <script> tags found before the repair to check").toBeGreaterThan(0);
  });

  it("client.ts constructs a storage adapter that cannot throw on the web path", () => {
    const clientSrc = readFileSync(
      resolve(__dirname, "../integrations/supabase/client.ts"),
      "utf8",
    );
    // The web branch must not hand supabase-js the bare `localStorage`
    // identifier directly — referencing it is exactly what threw before
    // React ever mounted. It must go through a function that can catch.
    expect(clientSrc).not.toMatch(/:\s*localStorage\s*[,)]/);
    expect(clientSrc).toMatch(/getWebAuthStorage/);
  });
});
