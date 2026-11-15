/**
 * THE TOP BAR'S BELL, NOW THE INBOX ICON (owner 11-15), NEVER SUSPENDS (Builder 2, 11-15; signed-in /jobs LCP).
 *
 * The bell loads on its own chunk (AppTopBar.tsx, Q2705). It was drawn through lazy() inside its own <Suspense>, and
 * the page that mounted the bar had its whole first commit held until that chunk came: cwv-lab signed-in /jobs (Slow
 * 4G + 4x CPU, 375, helper persona, performance marks on a local build) rendered the cards at 4.37 s with every read
 * answered, and committed them at 4.84 s, the frame the bell's three chunks finished. So TopBarBell draws the 44px
 * square itself until the module is in hand, then the bell: no lazy(), no Suspense.
 *
 * THE CHECK, read from source (comments blanked): TopBarBell's body holds no lazy() and no <Suspense>, starts from the
 * warmed module (bellLoaded) and draws the placeholder square when it has none.
 *
 * @mutate src/components/sections/AppTopBar.tsx | const [Impl, setImpl] = useState<InboxIcon \| null>(() => inboxLoaded); | const [Impl, setImpl] = useState<InboxIcon \| null>(() => inboxLoaded); const Lz = lazy(() => loadInbox().then((b) => ({ default: b as InboxIcon }))); if (!Impl) return <Suspense fallback={null}><Lz /></Suspense>;
 * @mutate src/components/sections/AppTopBar.tsx | const [Impl, setImpl] = useState<InboxIcon \| null>(() => inboxLoaded); | const [Impl, setImpl] = useState<InboxIcon \| null>(() => null);
 * @mutate src/components/sections/AppTopBar.tsx | return Impl ? <Impl /> : <span aria-hidden className="inline-block h-11 w-11" data-inbox-placeholder="" />; | return Impl ? <Impl /> : null;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");

/** TopBarInbox's body (TopBarBell until owner 11-15): from its signature to the next top-level declaration. */
function topBarBellBody(): string {
  const src = blankComments(readFileSync(resolve(ROOT, "src/components/sections/AppTopBar.tsx"), "utf8"));
  const start = src.indexOf("function TopBarInbox(");
  expect(start).toBeGreaterThan(-1);
  const rest = src.slice(start);
  const end = rest.search(/\n(?:export |const |function |let |type )/);
  return end > 0 ? rest.slice(0, end) : rest;
}

describe("the top bar's bell never holds the page's first commit", () => {
  it("TopBarInbox draws without lazy() or Suspense", () => {
    const body = topBarBellBody();
    // Inventory floor: the slice really is the component (signature, state, effect, both draws).
    expect(body.split("\n").length).toBeGreaterThan(8);
    expect(body).not.toMatch(/\blazy\(/);
    expect(body).not.toMatch(/<Suspense\b/);
  });

  it("starts from the warmed module and holds the bell's square until it draws", () => {
    const body = topBarBellBody();
    expect(body).toMatch(/useState<InboxIcon \| null>\(\(\) => inboxLoaded\)/);
    expect(body).toMatch(/loadInbox\(\)\.then\(/);
    expect(body).toMatch(/: <span aria-hidden className="inline-block h-11 w-11" data-inbox-placeholder="" \/>/);
  });
});
