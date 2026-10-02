/**
 * NO ACTION LABEL IN src/ IS CUT OFF WITHOUT ITS FULL TEXT BEING AVAILABLE
 * SOMEWHERE ELSE (Q108; widened from src/components/profile to src/ by Q116).
 *
 * ── WHAT SHIPPED ────────────────────────────────────────────────────────────
 * /profile?tab=credentials, after a license was sent, measured at 375 on
 * 2026-09-23 (helper test account, prod data, ~/.lh-shots/q108):
 *
 *   "View the License You Se…"   scrollWidth 171 > clientWidth 169
 *
 * The sent-document button in CredentialsTab.tsx carried `truncate`. A
 * truncated action label hides what the control does; the user has to guess.
 * The fix lets it wrap (`break-words`), and the row stays 44px tall.
 *
 * ── THE CLASS ───────────────────────────────────────────────────────────────
 * An interactive element (`a`, `button`, `Button`, `Link`, `NavLink`, any
 * Radix `*Trigger` or menu `*Item`, or any element with role
 * button/link/tab/menuitem) that carries, or wraps a descendant that carries,
 * a clipping class (`truncate`, `text-ellipsis`, `line-clamp-N`, any
 * breakpoint variant of those) is a defect UNLESS the full text is still
 * reachable: a `title` or `aria-label` on the interactive element or on the
 * clipped descendant.
 *
 * Inventory: every .tsx under src/ (components, pages, everything), parsed
 * with the TypeScript compiler (so comments and prose never count). KNOWN lists
 * the offenders still standing, each with its reason. It is EXACT: a new
 * offender fails, and fixing a known one fails until it is removed from the list.
 *
 * ── Q116 (2026-09-23) ───────────────────────────────────────────────────────
 * Widening to src/ took the inventory from 112 controls (profile only) to 828
 * controls in 501 files and found 37 new offenders (39 with the two profile
 * ones). 15 were user data truncated on purpose (names, job titles, message
 * previews, file names, locations) and now carry a `title` with the full text.
 * Measured on prod as poster-e2e, /messages at 375: job title "Bring in patio
 * furniture and secure the shed" sw241 > cw231 and preview "Should be wrapped
 * up in a couple of hours." sw261 > cw231, both with no title; after, every
 * row carries it (~/.lh-shots/q116/{before,after}/measure.txt).
 */
// @mutate src/components/profile/CredentialsTab.tsx | text-ds-13 text-primary underline break-words | text-ds-13 text-primary underline truncate
// @mutate src/components/messages/ConversationRow.tsx | title={c.jobTitle} | data-q116-mutant={c.jobTitle}
// @mutate src/test/truncatedActionLabel.test.ts | ?.label":\n    "MEASURED NOT CLIPPED | ?.label":\n    "Q119 not yet measured
// @mutate src/components/policy/CollapsedPolicy.tsx | <span className="text-ds-13 font-semibold text-foreground leading-snug"> | <span className="text-ds-13 font-semibold text-foreground line-clamp-2 leading-snug">
// @mutate src/components/dashboard/browseTasksToolbar/BrowseSearchBar.tsx | <span className="truncate" title={q}>{q}</span> | <span className="truncate">{q}</span>
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const SCAN_DIR = join(ROOT, "src");

const INTERACTIVE_TAGS = new Set(["a", "button", "Button", "Link", "NavLink"]);
const INTERACTIVE_ROLES = new Set(["button", "link", "tab", "menuitem"]);
const CLIP_RE = /(^|\s)(?:[a-z0-9-]+:)*(truncate|text-ellipsis|line-clamp-(?:\d+|\[[^\]]+\]))(?=\s|$)/;

/**
 * Offenders still standing, each with the reason it may stay. Remove an entry
 * when its offender is fixed or given its full text.
 * Key: `<file>:<interactive tag>:<clipped text>`.
 *
 * MEASURED NOT CLIPPED: scrollWidth/clientWidth (line-clamp: scrollHeight/
 * clientHeight) at 320, 375 and 1440 as poster-e2e on 2026-09-23.
 * Every entry carries its dated measurement; a new offender may not stand as
 * "not yet measured". Q119 measured the last eleven on 2026-09-27, including
 * opened states the default-state sweep cannot reach (long-press menus, the
 * job dialog, post-job, admin). The on-screen sweep for the default state of
 * every route is e2e/prod-audit/clipped-labels.spec.ts.
 *
 * Q119 (2026-09-26): the eight that print USER DATA (a city, a search, an
 * address, a pet's breed line, a draft's title, a saved search's summary) now
 * carry a `title`, since input of any length can clip; the policy item TITLE
 * clipped on /rules at 320 ("…$1,000…", sh 54 > ch 36) and now wraps unclamped.
 */
// @two-way src/test/truncatedActionLabel.test.ts:expect([...offenders].sort()).toEqual(Object.keys(KNOWN).sort());
const KNOWN: Record<string, string> = {
  "src/components/profile/LegalTab.tsx:TabsTrigger:{TAB_LABELS[key]}":
    "MEASURED NOT CLIPPED 2026-09-23: Terms/Rules/Privacy sw==cw (35/31/41px) at 320 and 375, 41/37/49 at 1440",
  "src/components/profile/profileLanding/SettingsSection.tsx:button:{item.desc}":
    "MEASURED NOT CLIPPED 2026-09-23: all 19 descriptions sh==ch (<=2 lines) at 320, 375 and 1440",
  "src/components/DatePickerField.tsx:button:{formatted}":
    "MEASURED NOT CLIPPED 2026-09-27 (Q119, prod): \"Select a date\" sw==cw on /post-job (Start Fresh) at 320, 375 and 1440 as poster-e2e",
  "src/components/DesktopSidebarNav.tsx:button:{label}":
    "MEASURED NOT CLIPPED 2026-09-27 (Q119, prod): all 25 admin sub-nav labels sw==cw on /admin at 1440 as admin-e2e (the sub-nav renders only at desktop)",
  "src/components/TimeRangeField.tsx:button:{display}":
    "MEASURED NOT CLIPPED 2026-09-27 (Q119, prod): \"9 AM – 5 PM\" sw==cw 89/89 at 320 on the availability editor as poster-e2e",
  "src/components/dashboard/jobDetailDialog/JobDetailFooter.tsx:Button:Apply Now":
    "MEASURED NOT CLIPPED 2026-09-27 (Q119, prod): \"Apply Now\" whole on the /browse job dialog at 320 (p3-poster-dialog-320); the footer row is 254px at 320, a 182px text box against the label's 79px",
  "src/components/dashboard/jobDetailDialog/JobDetailFooter.tsx:Button:{guestCtaLabel}":
    "MEASURED NOT CLIPPED 2026-09-27 (Q119, prod): \"Sign Up to Apply\" sw==cw 146/146 on guest /browse?job=<id> at 320, 375 and 1440",
  'src/components/dashboard/jobDetailDialog/JobDetailFooter.tsx:button:{(job.credential_tier ?? 0) === 2 ? "Licensed Pros Only" : "':
    "MEASURED NOT CLIPPED 2026-09-27 (Q119, prod): no credential_tier>0 open job on prod, so this button's markup was injected alone into the real footer row (254px at 320, 309 at 375, 726 at 1440): \"Licensed Pros Only\" 138, \"Licensed & Insured Only\" 174, sw==cw at 320, 375 and 1440",
  "src/components/mobileNav/NavQuickMenu.tsx:button:{label}":
    "MEASURED NOT CLIPPED 2026-09-27 (Q119, prod): long-press Posts quick filters (Needs You/Waiting/Scheduled/Done/Cancelled) and Messages recent chats sw==cw at 320 and 375 as poster-e2e",
  "src/components/mobileNav/NavQuickMenu.tsx:button:{sub}":
    "MEASURED NOT CLIPPED 2026-09-27 (Q119, prod): recent-chat subtitles (\"Helper reply ...\") sw==cw 194/194 at 320 as poster-e2e",
  "src/components/policy/CollapsedPolicy.tsx:CollapsibleTrigger:{isSearching ? highlight(subtitle, query) : subtitle}":
    "MEASURED NOT CLIPPED 2026-09-26 (Q119): all 23 section subtitles on /legal, /terms, /privacy, /rules sh==ch at 320, 375 and 1440 (guest, local build on prod)",
  "src/components/job-card/ActivitySectionedView.tsx:button:{sectionLabels[key]}":
    "MEASURED NOT CLIPPED 2026-09-27 (Q119, prod): Active/Completed/Cancelled section headers sw==cw on /posts?filter=all at 320, 375 and 1440 as poster-e2e",
  "src/pages/profile/petProfiles/PetCard.tsx:button:{SPECIES_OPTIONS.find((s) => s.value === pet.species)?.label":
    "MEASURED NOT CLIPPED 2026-09-27 (Q119, prod): species line sw==cw 166/166 at 320 on the pets page as poster-e2e",
  "src/pages/post-job/FormStep.tsx:Button:{submitLabel}":
    "MEASURED NOT CLIPPED 2026-09-27 (Q119, prod): \"Add a Title to Continue\" sw==cw on /post-job (Start Fresh) at 320, 375 and 1440 as poster-e2e",
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".tsx") && !/\.test\.tsx$/.test(p)) out.push(p);
  }
  return out;
}

type Opening = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

function attr(el: Opening, name: string): ts.JsxAttribute | undefined {
  return el.attributes.properties.find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === name,
  );
}

/** Every string fragment inside a className (literal, cn(...) args, templates). */
function classText(el: Opening): string {
  const a = attr(el, "className");
  if (!a?.initializer) return "";
  const parts: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) parts.push(n.text);
    else if (ts.isTemplateExpression(n)) {
      parts.push(n.head.text);
      n.templateSpans.forEach((s) => parts.push(s.literal.text));
    }
    ts.forEachChild(n, visit);
  };
  visit(a.initializer);
  return parts.join(" ");
}

function isInteractive(el: Opening): boolean {
  const tag = el.tagName.getText();
  // Radix controls render a <button>: TabsTrigger, DropdownMenuTrigger, SelectTrigger...
  if (INTERACTIVE_TAGS.has(tag) || /Trigger$/.test(tag) || /^(DropdownMenu|ContextMenu|Menubar)Item$/.test(tag)) return true;
  const role = attr(el, "role")?.initializer;
  return !!role && ts.isStringLiteral(role) && INTERACTIVE_ROLES.has(role.text);
}

const hasFullText = (el: Opening) => !!(attr(el, "title") || attr(el, "aria-label"));

function openingOf(n: ts.Node): Opening | undefined {
  if (ts.isJsxElement(n)) return n.openingElement;
  if (ts.isJsxSelfClosingElement(n)) return n;
  return undefined;
}

export function scanSource(file: string, src: string) {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let interactive = 0;
  const offenders: string[] = [];
  // The clipped element's own children as written, e.g. "View the {KIND_NOUN_TITLE[kind]} You Sent".
  const label = (n: ts.Node) =>
    (ts.isJsxElement(n) ? n.children.map((c) => c.getText(sf)).join("") : n.getText(sf))
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);
  const visit = (n: ts.Node) => {
    const open = openingOf(n);
    if (open && isInteractive(open)) {
      interactive++;
      if (!hasFullText(open)) {
        // The element itself, then every descendant that is not its own control.
        const check = (m: ts.Node, self: boolean) => {
          const o = openingOf(m);
          if (o && !self && isInteractive(o)) return; // counted on its own visit
          if (o && CLIP_RE.test(classText(o)) && !hasFullText(o)) {
            offenders.push(`${file}:${open.tagName.getText()}:${label(m)}`);
            return;
          }
          ts.forEachChild(m, (c) => check(c, false));
        };
        check(n, true);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { interactive, offenders };
}

function scanAll() {
  let interactive = 0;
  const offenders: string[] = [];
  const files = walk(SCAN_DIR);
  for (const f of files) {
    const r = scanSource(relative(ROOT, f), readFileSync(f, "utf8"));
    interactive += r.interactive;
    offenders.push(...r.offenders);
  }
  return { files: files.length, interactive, offenders };
}

describe("truncated action labels (Q108)", () => {
  const { files, interactive, offenders } = scanAll();

  it("inventories the whole src/ surface, not an empty glob", () => {
    expect(files).toBeGreaterThan(489); // 490 on 2026-09-24 (dead-code deletions Q364)
    expect(interactive).toBeGreaterThan(797); // 798 on 2026-09-24 (Broadcasts + dead-code deletions)
  });

  it("the detector fires on the original Q108 markup and respects title/aria-label", () => {
    const bad = `const X = () => <button className="flex-1 text-left text-ds-13 text-primary underline truncate">View the License You Sent</button>;`;
    expect(scanSource("fixture.tsx", bad).offenders).toHaveLength(1);
    const nested = `const X = () => <Button><span className={cn("block", ok && "sm:line-clamp-2")}>Label</span></Button>;`;
    expect(scanSource("fixture.tsx", nested).offenders).toHaveLength(1);
    const titled = `const X = () => <button title="View the License You Sent" className="truncate">View</button>;`;
    expect(scanSource("fixture.tsx", titled).offenders).toHaveLength(0);
    const wraps = `const X = () => <button className="flex-1 min-w-0 break-words">View the License You Sent</button>;`;
    expect(scanSource("fixture.tsx", wraps).offenders).toHaveLength(0);
    const commented = `const X = () => <button className="w-full">{/* truncate */}Go</button>;`;
    expect(scanSource("fixture.tsx", commented).offenders).toHaveLength(0);
  });

  it("no clipped action label without its full text, exactly the KNOWN list", () => {
    expect([...offenders].sort()).toEqual(Object.keys(KNOWN).sort());
  });

  it("every KNOWN entry records a dated on-screen measurement (Q119)", () => {
    const unmeasured = Object.entries(KNOWN).filter(([, why]) => !/^MEASURED NOT CLIPPED \d{4}-\d{2}-\d{2}\b.*\d/.test(why));
    expect(unmeasured).toEqual([]);
  });
});
