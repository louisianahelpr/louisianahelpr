/**
 * A SEARCH ✕ WORKS WHEN A HUMAN PRESSES IT, NOT ONLY ITS EXACT CENTRE.
 *
 * Owner, 2026-10-01: "the x button in jobs does not work", then the same X on
 * /profile?tab=saved_helpers at 1440 "does nothing when clicked".
 *
 * Every search clear-X is centred with `top-1/2 -translate-y-1/2` and wears
 * `.btn-press`, whose unlayered `:active { transform: scale(0.97) }` replaced
 * the translate on press: the X dropped ~14px (rect y 89 -> 103.42 on /jobs,
 * 156 -> 170.42 on saved_helpers), mouseup landed on the input, and no click
 * fired. Playwright's centre click still passed (the dropped box still covered
 * the centre point), which is why every existing spec was green.
 *
 * So this presses the way a person aiming at the top stroke does: 30% down the
 * glyph, holds, reads the rect while :active, then releases. The ✕ must not
 * move, and the press must act (field closed, or emptied where the ✕ clears).
 * It also asserts the ✕ is centred in its field (|centre offset| < 1px).
 * Inventory: src/test/searchFieldsAllChecked.test.ts derives every search
 * field with a ✕ from source and fails unless each has a surface here at 375
 * and 1440 (BrowseSearchBar once since Q2205: the desktop feed strip on /jobs).
 *
 * Run: PLAYWRIGHT_WEB_SERVER=1 npx playwright test --project=prod-audit search-x-off-center-press
 */
// @mutate src/index.css | here to this. */\n  transform: translate(var(--tw-translate-x, 0), var(--tw-translate-y, 0)) scale(0.97); | here to this. */\n  transform: scale(0.97);
// @mutate src/index.css | Chromium and WebKit, 2026-10-07). Keep the translate, drop the rest. */\n    transform: translate(var(--tw-translate-x, 0), var(--tw-translate-y, 0)); | Chromium and WebKit, 2026-10-07). Keep the translate, drop the rest. */\n    transform: none;

// The ✕ is centred in its INPUT, not in a wrapper the flex row stretched past
// it (4.00px off in vacuity run 38173155817: Add Admin beside its 56px button,
// and Find a User beside the Sort trigger's 44px floor at 1440).
// @mutate src/components/admin/settings/AdminUserSearchField.tsx | <div className="relative flex-1 self-start"> | <div className="relative flex-1">
// @mutate src/components/admin/AdminUsers.tsx | <div className="relative flex-1 sm:self-start"> | <div className="relative flex-1">
import { test, expect, webkit, type Browser } from "../prodTest";
import { getSession, type Session } from "./harness";
import { AUTH_STORAGE_KEY } from "../journeys/fixtures";

const SHOTS = process.env.LH_SEARCH_SHOTS;

let poster: Session;
let admin: Session;
test.beforeAll(async ({ request }) => {
  poster = await getSession(request, "poster");
  // Q913: the admin console's six search fields.
  admin = await getSession(request, "admin");
});

const CLOSE = 'button[aria-label="Close search"]';
const CLEAR = 'button[aria-label="Clear search"]';

/** `file` is the component that renders the field and its ✕. The inventory
 * guard (src/test/searchFieldsAllChecked.test.ts) scans src for every search
 * field with a ✕ and fails unless each file has a surface here at 375 AND at
 * 1440 — inventory minus checked is empty. */
// `as: "admin"` signs in the admin test account; `key` opens a surface that has
// no trigger element (the Cmd-K palette) by pressing it instead of a click.
const SURFACES: { name: string; file: string; url: string; trigger: string; field: string; close: string; minWidth?: number; maxWidth?: number; as?: "admin"; key?: string }[] = [
  // browse-phone (/home), jobs (/jobs) and posts (/posts) left 2026-10-19 (Q2205): the phone Browse bar, My Jobs and
  // My Posts were retired with the old screens. Jobs > Browse is jobs-browse-row below; Posted / Working's search opens
  // in place in their status chip row (owner 2026-10-27, InlineListSearch): jobs-posted-search below.
  {
    name: "saved-helprs", file: "src/components/profile/SavedHelpersTab.tsx",
    url: "/profile?tab=saved_helpers",
    trigger: 'button[aria-label="Search saved Helprs"]',
    field: 'input[aria-label="Search saved Helprs"]',
    close: CLOSE,
  },
  {
    name: "messages", file: "src/components/messages/ConversationList.tsx",
    url: "/messages",
    trigger: "[data-search-trigger]",
    field: 'input[aria-label="Search conversations"]',
    close: CLOSE,
  },
  // The section dashboards (owner, 2026-10-19): every Browse (Jobs, Declutter,
  // Shops, Homes) opens on the ONE shared permanent search row (SectionSearchRow),
  // so the field is the trigger and the ✕ clears. Pressed in each section.
  // Jobs > Browse on a phone (owner 2026-10-28: "search and filter should be next to gear"): a search icon at
  // the tabs row's end that opens in place (InlineListSearch), like Posted / Working's.
  {
    name: "jobs-browse-phone", file: "src/components/sections/InlineListSearch.tsx",
    url: "/jobs",
    trigger: '[data-browse-phone-controls] button[aria-label="Search jobs"]',
    field: '[data-browse-phone-controls] input[aria-label="Search jobs"]',
    close: `[data-browse-phone-controls] ${CLOSE}`,
    maxWidth: 899,
  },
  {
    name: "declutter-browse-phone", file: "src/components/sections/InlineListSearch.tsx",
    url: "/declutter",
    trigger: '[data-browse-phone-controls] button[aria-label="Search items"]',
    field: '[data-browse-phone-controls] input[aria-label="Search items"]',
    maxWidth: 899,
    close: `[data-browse-phone-controls] ${CLOSE}`,
  },
  {
    name: "shops-browse-row", file: "src/components/sections/SectionSearchRow.tsx",
    url: "/shops",
    trigger: 'input[aria-label="Search shops"]',
    field: 'input[aria-label="Search shops"]',
    close: CLEAR,
  },
  {
    name: "browse-desktop-strip", file: "src/components/dashboard/browseTasksToolbar/BrowseSearchBar.tsx",
    url: "/jobs",
    trigger: "[data-feed-strip] [data-search-trigger]",
    field: '[data-feed-strip] input[aria-label="Search jobs"]',
    close: `[data-feed-strip] ${CLOSE}`,
    minWidth: 900,
  },
  {
    name: "jobs-posted-search", file: "src/components/sections/InlineListSearch.tsx",
    url: "/jobs?tab=posted",
    trigger: 'button[aria-label="Search posted jobs"]',
    field: 'input[aria-label="Search posted jobs"]',
    close: CLOSE,
  },
  {
    name: "legal", file: "src/pages/info/Legal.tsx",
    url: "/legal",
    trigger: 'button[aria-label="Search all policies"]',
    field: 'input[aria-label="Search all policies"]',
    close: CLOSE,
  },
  // Q913 (owner, 2026-10-07): the admin fields are permanent, so the trigger
  // is the field itself (or the tab / dialog that shows it) and the ✕ clears.
  {
    name: "admin-users", file: "src/components/admin/AdminUsers.tsx", as: "admin",
    url: "/admin?view=people",
    trigger: 'input[aria-label="Search users by name, email, phone, or job UUID"]',
    field: 'input[aria-label="Search users by name, email, phone, or job UUID"]',
    close: CLEAR,
  },
  {
    name: "admin-notification-logs", file: "src/components/admin/AdminNotificationLogs.tsx", as: "admin",
    url: "/admin?view=notiflogs",
    trigger: 'input[aria-label="Search notifications"]',
    field: 'input[aria-label="Search notifications"]',
    close: CLEAR,
  },
  {
    name: "admin-referrals", file: "src/components/admin/AdminReferrals.tsx", as: "admin",
    url: "/admin?view=referrals",
    trigger: '[aria-label="Referral sections"] button >> nth=1',
    field: 'input[aria-label="Search referrals by name or code"]',
    close: CLEAR,
  },
  {
    name: "admin-subscriptions", file: "src/components/admin/AdminSubscriptions.tsx", as: "admin",
    url: "/admin?view=subscriptions",
    trigger: 'input[aria-label="Search subscriptions by name, email, or tier"]',
    field: 'input[aria-label="Search subscriptions by name, email, or tier"]',
    close: CLEAR,
  },
  {
    name: "admin-settings-add-admin", file: "src/components/admin/settings/AdminUserSearchField.tsx", as: "admin",
    url: "/admin?view=settings",
    trigger: 'button:has-text("Add Admin")',
    field: 'input[aria-label="Search users by name or email"]',
    close: CLEAR,
  },
  // Homes Browse (2026-10-19): the slim City or ZIP row is a permanent field; its ✕ clears.
  {
    name: "homes-rent", file: "src/components/sections/SectionSearchRow.tsx",
    url: "/rentals",
    trigger: 'input[aria-label="City or ZIP"]',
    field: 'input[aria-label="City or ZIP"]',
    close: CLEAR,
  },
  {
    name: "admin-command-palette", file: "src/components/admin/AdminCommandPalette.tsx", as: "admin",
    url: "/admin",
    trigger: "",
    key: "Control+k",
    field: '[role="dialog"] input[aria-label="Search admin sections"]',
    close: `[role="dialog"] ${CLEAR}`,
  },
  {
    // Board 89: /search, one search across the sections; the field is always open.
    name: "search-page", file: "src/pages/search/SearchPage.tsx",
    url: "/search?q=chair",
    trigger: "",
    field: 'form[aria-label="Search Helpr"] input[type="search"]',
    close: CLEAR,
  },
];

// Q910: Reduce Motion is a second pass. Its at-rest `.btn-press` rule once
// set `transform: none`, which (unlayered, after Tailwind's utilities, equal
// specificity) erased every `-translate-y-1/2` with no press at all: the ✕ sat
// half its height low (22px in a 44px field, Chromium and WebKit alike, so one
// engine is enough for the cascade). The centring assertion below catches it.
const MOTIONS = { chromium: ["no-preference", "reduce"], webkit: ["no-preference"] } as const;

for (const engine of ["chromium", "webkit"] as const) {
  for (const vw of [375, 1440] as const) {
    for (const motion of MOTIONS[engine]) for (const s of SURFACES) {
      const tag = motion === "reduce" ? " reduced-motion" : "";
      test(`${s.name}: an off-centre press on the ✕ acts and the ✕ stays put @${vw} ${engine}${tag}`, async ({ browser: def }, info) => {
        test.skip(!!s.minWidth && vw < s.minWidth, `${s.name} does not render at ${vw}`);
        test.skip(!!s.maxWidth && vw > s.maxWidth, `${s.name} does not render at ${vw}`);
        test.setTimeout(120_000);
        const browser: Browser = engine === "chromium" ? def : await webkit.launch();
        const ctx = await browser.newContext({
          baseURL: info.project.use.baseURL,
          viewport: { width: vw, height: vw >= 900 ? 900 : 812 },
          serviceWorkers: "block",
          reducedMotion: motion,
        });
        try {
          await ctx.addInitScript(
            ({ key, val }) => {
              try {
                localStorage.setItem(key, val);
                localStorage.setItem("helpr_onboarding", JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }));
              } catch {
                /* signed out: the trigger wait below fails visibly */
              }
            },
            { key: AUTH_STORAGE_KEY, val: JSON.stringify(s.as === "admin" ? admin : poster) },
          );
          const page = await ctx.newPage();
          await page.goto(s.url, { waitUntil: "domcontentloaded" });
          if (s.key) {
            // No trigger element: wait for the page, then press the shortcut.
            await page.waitForLoadState("networkidle", { timeout: 45_000 }).catch(() => {});
            await page.waitForTimeout(1000);
            await page.keyboard.press(s.key);
          } else {
            const trigger = page.locator(s.trigger).first();
            await trigger.waitFor({ state: "visible", timeout: 45_000 });
            await page.waitForTimeout(1000);
            await trigger.click();
          }
          const field = page.locator(s.field).first();
          await field.fill("zzz");
          await page.waitForTimeout(450);
          const x = page.locator(s.close).first();
          const rest = await x.boundingBox();
          expect(rest, `${s.name}: no ✕ in the open field — nothing was pressed`).not.toBeNull();
          // CENTRED: the ✕'s vertical centre is the field's (owner, 2026-10-01:
          // "check the x's on the search bars globally").
          const fb = (await field.boundingBox())!;
          const centreOff = rest!.y + rest!.height / 2 - (fb.y + fb.height / 2);
          if (SHOTS) await page.screenshot({ path: `${SHOTS}/x-${s.name}-${vw}-${engine}${motion === "reduce" ? "-rm" : ""}-open.png` });
          // A person aiming at the X's top stroke: 30% down the glyph.
          await page.mouse.move(rest!.x + rest!.width / 2, rest!.y + rest!.height * 0.3);
          await page.mouse.down();
          await page.waitForTimeout(150);
          const pressed = await x.boundingBox();
          await page.mouse.up();
          await page.waitForTimeout(600);
          const stillOpen = await field.count();
          const value = stillOpen ? await field.inputValue() : "";
          const msg = `${s.name}@${vw} ${engine}${tag}: ✕ centre off field centre ${centreOff.toFixed(2)}px, rest y ${rest!.y.toFixed(2)}, pressed y ${pressed?.y.toFixed(2)}, field open after ${stillOpen}, value "${value}"`;
          info.annotations.push({ type: "press", description: msg });
          console.log(msg);
          // :active scales 0.97 about the centre, so y moves by ~0.4px; a
          // replaced translate moves it by half its height.
          expect(Math.abs(centreOff), `${msg} — the ✕ is not centred in its field`).toBeLessThan(1);
          expect(Math.abs((pressed?.y ?? Infinity) - rest!.y), `${msg} — the ✕ moved while pressed`).toBeLessThan(1);
          expect(stillOpen === 0 || value === "", `${msg} — the press did nothing`).toBe(true);
        } finally {
          await ctx.close();
          if (engine !== "chromium") await browser.close();
        }
      });
    }
  }
}
