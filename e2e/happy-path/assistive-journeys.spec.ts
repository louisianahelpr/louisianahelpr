import type { BrowserContext, Locator, Page, TestInfo } from "@playwright/test";
import {
  test,
  expect,
  FAKE_CUSTOMER,
  FAKE_HELPER,
  buildFakeProfile,
  installSupabaseMocks,
  seedAuthedSession,
  mockTable,
  mockRpc,
  type FakeUser,
  type MockRule,
} from "./fixtures";
import { measureLayout } from "./auditRoutes";
import { SEED_JOBS, SEED_PROFILES } from "./seedData";
import { findErrorScreen, detectStuckOrBlank } from "../errorScreens";

/**
 * Assistive journeys — the core tasks done the way a keyboard-only user, a
 * large-text user and a reduced-motion user actually do them.
 *
 * WHY THIS EXISTS (owner, 2026-09-12): audits must act like REAL users,
 * including people who don't use a mouse or who need larger text. The
 * required profile photo on /complete-profile was a `<label>` wrapping a
 * `display:none` file input: a mouse tapped the label and the picker opened; a
 * keyboard had nothing to land on, so the one screen that will not let you
 * leave without a photo could not be completed. Nothing caught it, because
 * every journey spec clicked.
 *
 * So this spec NEVER clicks. Every control is reached with Tab / Shift+Tab and
 * operated with Enter / Space / Escape / arrows, and on every hop it asserts:
 *   - focus is on a real element (never <body>), with a VISIBLE indicator
 *     (computed outline or box-shadow, not the class list);
 *   - the focused control has an accessible name;
 *   - Tab never cycles without reaching the target (no keyboard trap);
 *   - dialogs take focus, hold it, and hand it back to the opener on close;
 *   - no error screen (`findErrorScreen`) and nothing stuck (`detectStuckOrBlank`).
 *
 * The same journeys run three times: default; the app's largest text size
 * (root font-size 24px → `--user-text-scale` 1.5 and `senior-mode`, see
 * src/lib/accessibility.ts + simpleMode.ts — the OS probe is Chromium-null so
 * the root-font-size fallback is what it reads); and prefers-reduced-motion:
 * reduce. Large text additionally asserts nothing overflows or is clipped
 * (`measureLayout`) and screenshots every step for a human to look at.
 */

// --- Modes ------------------------------------------------------------------

type ModeName = "default" | "large-text" | "reduced-motion";

interface Mode {
  name: ModeName;
  setup: (context: BrowserContext, page: Page) => Promise<void>;
}

const LARGE_ROOT_PX = 24; // 24/16 = 1.5 — the ceiling useDynamicTypeSync clamps to.

const MODES: Mode[] = [
  { name: "default", setup: async () => {} },
  {
    name: "large-text",
    setup: async (context) => {
      await context.addInitScript((px: number) => {
        const apply = () => {
          document.documentElement.style.fontSize = `${px}px`;
        };
        apply();
        document.addEventListener("DOMContentLoaded", apply);
        try {
          // The explicit user choice for the merged large-text/simple mode.
          window.localStorage.setItem("helpr_simple_mode", "1");
        } catch {
          /* storage blocked — the scale alone still flips senior-mode at >=1.2 */
        }
      }, LARGE_ROOT_PX);
    },
  },
  {
    name: "reduced-motion",
    setup: async (_context, page) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
    },
  },
];

// --- Test data ----------------------------------------------------------------

// 1x1 PNG. Passes the image/* accept filter and the 5 MB ceiling.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
const photo = (name: string) => ({ name, mimeType: "image/png", buffer: PNG_BYTES });

const STRONG_PASSWORD = "Keyb0ard!Only#2026";

// --- Focus probes (run in the page) -------------------------------------------

interface FocusReport {
  onBody: boolean;
  tag: string;
  id: string;
  role: string;
  type: string;
  name: string;
  visibleIndicator: boolean;
  indicator: string;
  inDialog: boolean;
  signature: string;
}

/**
 * Everything the spec asserts about the currently focused element, computed
 * from the live DOM — never from class names.
 */
function probeFocus(): FocusReport {
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body || el === document.documentElement) {
    return { onBody: true, tag: "BODY", id: "", role: "", type: "", name: "", visibleIndicator: false, indicator: "", inDialog: false, signature: "BODY" };
  }
  const textOf = (n: Element | null) => (n?.textContent ?? "").replace(/\s+/g, " ").trim();
  const byIds = (ids: string | null) =>
    (ids ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => textOf(document.getElementById(id)))
      .join(" ")
      .trim();
  // Accessible name, in roughly the accname priority order.
  let name = "";
  if (el.getAttribute("aria-labelledby")) name = byIds(el.getAttribute("aria-labelledby"));
  if (!name) name = (el.getAttribute("aria-label") ?? "").trim();
  if (!name && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) {
    const labels = (el as HTMLInputElement).labels;
    if (labels && labels.length) name = Array.from(labels).map((l) => textOf(l)).join(" ").trim();
    if (!name && el.id) name = textOf(document.querySelector(`label[for="${el.id}"]`));
    if (!name) name = textOf(el.closest("label"));
  }
  if (!name) {
    const img = el.querySelector("img[alt]");
    name = textOf(el) || (img?.getAttribute("alt") ?? "") || (el.getAttribute("title") ?? "");
  }
  if (!name && el instanceof HTMLInputElement && el.placeholder) name = el.placeholder;

  // Visible indicator: an outline with width and a non-transparent colour, or
  // a box-shadow (Tailwind rings). A visually-hidden control (sr-only, 1px)
  // may draw its ring on the wrapper via :focus-within, so walk up three levels.
  const hasIndicator = (n: Element): string | null => {
    const cs = getComputedStyle(n);
    const w = parseFloat(cs.outlineWidth);
    const alpha = (() => {
      const m = /rgba?\(([^)]+)\)/.exec(cs.outlineColor);
      if (!m) return 1;
      const parts = m[1].split(",").map((p) => parseFloat(p));
      return parts.length === 4 ? parts[3] : 1;
    })();
    if (cs.outlineStyle !== "none" && w > 0 && alpha > 0) return `outline ${cs.outlineStyle} ${w}px`;
    if (cs.boxShadow && cs.boxShadow !== "none") return `box-shadow ${cs.boxShadow.slice(0, 40)}`;
    return null;
  };
  const r = el.getBoundingClientRect();
  const tiny = r.width <= 1 || r.height <= 1;
  let indicator = hasIndicator(el);
  if (!indicator && tiny) {
    let p: Element | null = el.parentElement;
    for (let i = 0; i < 3 && p && !indicator; i++, p = p.parentElement) indicator = hasIndicator(p);
  }
  const dialog = el.closest('[role="dialog"], [role="alertdialog"]');
  const sig = `${el.tagName}#${el.id}[${el.getAttribute("role") ?? ""}]"${name.slice(0, 40)}"`;
  return {
    onBody: false,
    tag: el.tagName,
    id: el.id,
    role: el.getAttribute("role") ?? "",
    type: el.getAttribute("type") ?? "",
    name,
    visibleIndicator: !!indicator,
    indicator: indicator ?? "",
    inDialog: !!dialog,
    signature: sig,
  };
}

// --- Harness ------------------------------------------------------------------

class Journey {
  private shot = 0;
  readonly notes: string[] = [];

  constructor(
    readonly page: Page,
    readonly info: TestInfo,
    readonly mode: Mode,
  ) {}

  /** Wait until nothing is loading, then check for error screens. */
  async settled(label: string): Promise<void> {
    const { page } = this;
    const deadline = Date.now() + 15_000;
    let stuck: string | null;
    for (;;) {
      stuck = await page.evaluate(detectStuckOrBlank).catch(() => "page navigated");
      if (!stuck || Date.now() > deadline) break;
      await page.waitForTimeout(150);
    }
    expect(stuck, `${label}: screen never settled — ${stuck}`).toBeNull();
    const text = await page.evaluate(() => document.body.innerText);
    const err = findErrorScreen(text);
    expect(err, `${label}: error screen "${err?.name}" — ${err?.excerpt}`).toBeNull();
  }

  /** A journey step: run it, settle, error-check, focus-check, and (large text) fit-check + screenshot. */
  async step(label: string, fn?: () => Promise<void>, opts: { allowBodyFocus?: boolean } = {}): Promise<void> {
    await test.step(`${this.mode.name} · ${label}`, async () => {
      if (fn) await fn();
      await this.settled(label);
      if (!opts.allowBodyFocus) {
        const f = await this.page.evaluate(probeFocus);
        expect(f.onBody, `${label}: focus fell to <body>`).toBe(false);
      }
      if (this.mode.name === "large-text") await this.assertFits(label);
      await this.screenshot(label);
    });
  }

  async screenshot(label: string): Promise<string> {
    const file = this.info.outputPath(`${String(++this.shot).padStart(2, "0")}-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`);
    await this.page.screenshot({ path: file }).catch(() => {});
    return file;
  }

  /** Large text: nothing wider than the viewport, nothing clipped, and report text overlaps. */
  async assertFits(label: string): Promise<void> {
    const layout = await measureLayout(this.page);
    expect(layout.overflowOffenders, `${label}: horizontal overflow at large text`).toEqual([]);
    expect(layout.clippedWideElements, `${label}: content wider than the screen, clipped by an ancestor`).toEqual([]);
    const overlaps = await this.page.evaluate(() => {
      const leaves = Array.from(document.querySelectorAll<HTMLElement>("#root *, [role=dialog] *")).filter((e) => {
        if (e.children.length) return false;
        if (!(e.textContent ?? "").trim()) return false;
        if (e.closest('[aria-hidden="true"], .sr-only')) return false;
        const cs = getComputedStyle(e);
        if (cs.visibility === "hidden" || cs.display === "none" || parseFloat(cs.opacity) < 0.05) return false;
        const r = e.getBoundingClientRect();
        return r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < innerHeight;
      });
      const out: string[] = [];
      for (let i = 0; i < leaves.length; i++) {
        const a = leaves[i].getBoundingClientRect();
        for (let j = i + 1; j < leaves.length; j++) {
          if (leaves[i].contains(leaves[j]) || leaves[j].contains(leaves[i])) continue;
          const b = leaves[j].getBoundingClientRect();
          const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (w <= 1 || h <= 1) continue;
          const inter = w * h;
          const smaller = Math.min(a.width * a.height, b.width * b.height);
          if (inter / smaller > 0.3) {
            out.push(`"${(leaves[i].textContent ?? "").trim().slice(0, 24)}" × "${(leaves[j].textContent ?? "").trim().slice(0, 24)}"`);
          }
        }
      }
      return out.slice(0, 12);
    });
    if (overlaps.length) {
      this.notes.push(`${label}: text overlaps — ${overlaps.join("; ")}`);
      this.info.annotations.push({ type: "large-text-overlap", description: `${label}: ${overlaps.join("; ")}` });
    }
  }

  /** Assert the CURRENT focus is a real, named, visibly-indicated control. */
  async assertFocusOk(where: string): Promise<FocusReport> {
    const f = await this.page.evaluate(probeFocus);
    expect(f.onBody, `${where}: focus is on <body>`).toBe(false);
    expect(f.visibleIndicator, `${where}: no visible focus indicator on ${f.signature} (computed outline/box-shadow)`).toBe(true);
    expect(f.name, `${where}: focused control has no accessible name — ${f.signature}`).not.toBe("");
    return f;
  }

  /**
   * Tab (or Shift+Tab) until `target` has focus. Every hop is focus-checked.
   * A trap is a cycle: when the focus order returns to where it started
   * without reaching the target, that is asserted as a failure with the
   * elements that were visited.
   */
  async tabTo(target: Locator, opts: { backwards?: boolean; max?: number; label?: string } = {}): Promise<FocusReport> {
    const { page } = this;
    const key = opts.backwards ? "Shift+Tab" : "Tab";
    const max = opts.max ?? 120;
    const label = opts.label ?? (await target.evaluate((e) => `${e.tagName}#${(e as HTMLElement).id}`).catch(() => "target"));
    const handle = await target.elementHandle({ timeout: 10_000 });
    expect(handle, `${label}: target not in the DOM`).not.toBeNull();
    const seen: string[] = [];
    for (let i = 0; i < max; i++) {
      await page.keyboard.press(key);
      const isTarget = await page.evaluate((t) => document.activeElement === t, handle);
      const f = await this.assertFocusOk(`Tab→${label} hop ${i + 1}`);
      if (isTarget) return f;
      // Same element twice in a row without reaching the target: nothing moved.
      if (seen.length && seen[seen.length - 1] === f.signature) {
        throw new Error(`${label}: Tab did not move focus off ${f.signature} — keyboard trap`);
      }
      // Back at the start after visiting others: a full cycle without the target.
      if (seen.length > 2 && seen[0] === f.signature) {
        throw new Error(`${label}: not reachable by ${key}. Focus order cycled through ${seen.length} controls:\n  ${seen.join("\n  ")}`);
      }
      seen.push(f.signature);
    }
    throw new Error(`${label}: not reached after ${max} ${key} presses. Visited:\n  ${seen.slice(-15).join("\n  ")}`);
  }

  /** Move to `target`, then type into it. */
  async tabAndType(target: Locator, text: string, label?: string): Promise<void> {
    await this.tabTo(target, { label });
    await this.page.keyboard.type(text, { delay: 5 });
  }

  /** Reach a file input by Tab, open its chooser with Space, and hand it files. */
  async tabAndChooseFiles(target: Locator, files: ReturnType<typeof photo>[], label: string): Promise<void> {
    const f = await this.tabTo(target, { label });
    expect(f.type, `${label}: Tab landed on ${f.signature}, expected the file input`).toBe("file");
    const chooser = this.page.waitForEvent("filechooser", { timeout: 5_000 });
    await this.page.keyboard.press("Space");
    const fc = await chooser;
    await fc.setFiles(files);
  }

  /** The open dialog: exists, is open, and holds focus. */
  async expectDialogTookFocus(label: string): Promise<Locator> {
    const dialog = this.page.locator('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]').last();
    await expect(dialog, `${label}: dialog did not open`).toBeVisible({ timeout: 10_000 });
    // Radix moves focus on the next frame; give it one.
    await expect
      .poll(async () => (await this.page.evaluate(probeFocus)).inDialog, { timeout: 3_000, message: `${label}: focus did not move into the dialog` })
      .toBe(true);
    return dialog;
  }

  /** Tab `n` times and prove focus never leaves the dialog. */
  async tabStaysInDialog(n: number, label: string): Promise<void> {
    for (let i = 0; i < n; i++) {
      await this.page.keyboard.press("Tab");
      const f = await this.assertFocusOk(`${label}: dialog Tab ${i + 1}`);
      expect(f.inDialog, `${label}: Tab ${i + 1} escaped the dialog to ${f.signature}`).toBe(true);
    }
  }

  /** Escape closes the dialog; focus lands on the opener (or at least not on <body>). */
  async escapeDialog(dialog: Locator, opener: Locator | null, label: string): Promise<void> {
    await this.page.keyboard.press("Escape");
    await expect(dialog, `${label}: Escape did not close the dialog`).toBeHidden({ timeout: 10_000 });
    const f = await this.page.evaluate(probeFocus);
    expect(f.onBody, `${label}: focus was lost to <body> after the dialog closed`).toBe(false);
    if (opener) {
      const returned = await opener.evaluate((e) => document.activeElement === e).catch(() => false);
      expect(returned, `${label}: focus did not return to the opener; it is on ${f.signature}`).toBe(true);
    }
  }
}

// --- Mock shapes ----------------------------------------------------------------

/**
 * A profile that is INCOMPLETE until the page PATCHes it. Signup ends on a
 * session whose profile has no photo (and no ZIP), so ProtectedRoute bounces
 * to /complete-profile; once the form writes, the same read reports complete
 * and the gate lets the account through. The match/handle split is what makes
 * the flip possible: the PATCH rule flips the flag and returns null, so the
 * fixture's echo-the-body default still answers the write.
 */
function completableProfile(user: FakeUser): MockRule[] {
  const state = { complete: false };
  const own = (url: URL) => {
    const wanted = url.searchParams.get("user_id") ?? url.searchParams.get("id") ?? "";
    return wanted === "" || wanted === `eq.${user.id}` || wanted === `eq.${user.id}-profile`;
  };
  return [
    {
      match: (url, method) => method === "PATCH" && url.pathname === "/rest/v1/profiles",
      handle: () => {
        state.complete = true;
        return null;
      },
    },
    {
      match: (url, method) => method === "GET" && url.pathname === "/rest/v1/profiles" && own(url),
      handle: () => ({
        status: 200,
        body: [
          state.complete
            ? buildFakeProfile(user)
            : { ...buildFakeProfile(user), avatar_url: null, zip_code: null, is_legacy_user: false },
        ],
      }),
    },
  ];
}

const FEED_RULES: MockRule[] = [
  mockRpc("get_public_platform_settings", [{ helper_fee_percent: 10 }]),
  mockRpc("get_safe_profiles", SEED_PROFILES),
  mockTable("open_jobs_browse", SEED_JOBS, { honorFilters: true }),
  mockTable("helper_availability", []),
  mockTable("applications", []),
  mockTable("user_blocks", []),
  mockTable("saved_jobs", []),
  mockTable("saved_searches", []),
  mockTable("reviews", []),
];

// --- The journeys -----------------------------------------------------------------

for (const mode of MODES) {
  test.describe(`assistive journeys · ${mode.name}`, () => {
    test.beforeEach(async ({ context, page }) => {
      await mode.setup(context, page);
    });

    test("sign up, then complete the profile — photo included — by keyboard", async ({ page, context, baseURL }, info) => {
      void context;
      void baseURL;
      const j = new Journey(page, info, mode);
      await installSupabaseMocks(page, { user: FAKE_CUSTOMER, rules: completableProfile(FAKE_CUSTOMER) });

      await page.goto("/signup");
      await j.step("signup step 1 renders", undefined, { allowBodyFocus: true });

      // Step 1 — credentials + agreements.
      await j.tabAndType(page.locator("#email"), FAKE_CUSTOMER.email, "email");
      await j.tabAndType(page.locator("#password"), STRONG_PASSWORD, "password");
      await j.tabTo(page.locator("#policies"), { label: "terms checkbox" });
      await page.keyboard.press("Space");
      await expect(page.locator("#policies")).toHaveAttribute("aria-checked", "true");
      await j.tabTo(page.locator("#age-confirm"), { label: "18+ checkbox" });
      await page.keyboard.press("Space");
      await expect(page.locator("#age-confirm")).toHaveAttribute("aria-checked", "true");
      await j.step("signup step 1 filled");
      await j.tabTo(page.getByRole("button", { name: /continue|create account|next/i }).last(), { label: "step 1 continue" });
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { name: /about you/i })).toBeVisible({ timeout: 10_000 });
      await j.step("signup step 2 renders", undefined, { allowBodyFocus: true });

      // Step 2 — about you. THE photo: reached by Tab, opened by Space.
      await j.tabAndChooseFiles(page.locator("#avatar"), [photo("me.png")], "signup profile photo");
      await expect(page.locator("#avatar")).toHaveJSProperty("files.length", 1);
      await j.tabAndType(page.locator("#firstName"), "Key", "first name");
      await j.tabAndType(page.locator("#lastName"), "Board", "last name");
      await j.tabTo(page.locator("#dob"), { label: "date of birth" });
      await pickDateByKeyboard(j, page.locator("#dob"), "date of birth");
      await j.tabAndType(page.locator("#phone"), "5045550123", "phone");
      await j.tabAndType(page.locator("#location"), "New Orleans", "city");
      await j.tabAndType(page.locator("#zipCode"), "70115", "ZIP");
      await j.step("signup step 2 filled");
      await j.tabTo(page.getByRole("button", { name: /create account|finish|continue|sign up/i }).last(), { label: "create account" });
      await page.keyboard.press("Enter");
      await page.waitForURL((u) => !/\/signup$/.test(u.pathname), { timeout: 15_000 });
      await j.step("left signup", undefined, { allowBodyFocus: true });

      // The gate: an incomplete profile lands on /complete-profile.
      await page.goto("/dashboard");
      await page.waitForURL(/\/complete-profile/, { timeout: 15_000 });
      await j.step("complete-profile renders", undefined, { allowBodyFocus: true });

      // The owner's bug: the REQUIRED photo must be reachable by Tab and openable by Space.
      await j.tabAndChooseFiles(page.locator("#avatar"), [photo("me.png")], "complete-profile photo");
      await expect(page.locator("#avatar")).toHaveJSProperty("files.length", 1);
      await j.tabAndType(page.locator("#zipCode"), "70115", "complete-profile ZIP");
      await j.tabTo(page.locator("#accept-policies"), { label: "complete-profile terms" });
      await page.keyboard.press("Space");
      await expect(page.locator("#accept-policies")).toHaveAttribute("aria-checked", "true");
      await j.step("complete-profile filled");
      const submit = page.locator('button[type="submit"]').last();
      await expect(submit).toBeEnabled({ timeout: 5_000 });
      await j.tabTo(submit, { label: "complete-profile submit" });
      await page.keyboard.press("Enter");
      await page.waitForURL((u) => !/\/complete-profile/.test(u.pathname), { timeout: 15_000 });
      await j.step("profile completed → in the app", undefined, { allowBodyFocus: true });
      report(j);
    });

    test("browse, filter, open a job and apply — by keyboard", async ({ page, context, baseURL }, info) => {
      const j = new Journey(page, info, mode);
      await seedAuthedSession(context, FAKE_HELPER, baseURL ?? "");
      await installSupabaseMocks(page, { user: FAKE_HELPER, rules: FEED_RULES });

      await page.goto("/dashboard");
      const firstTitle = SEED_JOBS[0].title;
      await expect(page.getByText(firstTitle).first()).toBeVisible({ timeout: 15_000 });
      await j.step("feed renders", undefined, { allowBodyFocus: true });

      // Filters: open the sheet, pick a category, prove it traps, close with Escape.
      const filtersBtn = page.getByRole("button", { name: /^filters/i }).first();
      await j.tabTo(filtersBtn, { label: "Filters button" });
      await page.keyboard.press("Enter");
      const sheet = await j.expectDialogTookFocus("filter sheet");
      await j.step("filter sheet open");
      const chip = sheet.getByRole("group", { name: /filter by category/i }).getByRole("button").nth(1);
      await j.tabTo(chip, { label: "category chip" });
      await page.keyboard.press("Enter");
      await j.tabStaysInDialog(8, "filter sheet");
      await j.escapeDialog(sheet, filtersBtn, "filter sheet");
      await j.step("filter applied, sheet closed");

      // Clear the filter again so the first seeded job is on screen, then open it.
      await page.keyboard.press("Enter");
      const sheet2 = await j.expectDialogTookFocus("filter sheet (reopen)");
      const clear = sheet2.getByRole("button", { name: /clear|reset/i }).first();
      if (await clear.count()) {
        await j.tabTo(clear, { label: "clear filters" });
        await page.keyboard.press("Enter");
      }
      if (await sheet2.isVisible()) await j.escapeDialog(sheet2, filtersBtn, "filter sheet (reopen)");

      const card = page.getByRole("button", { name: new RegExp(`^${escapeRe(firstTitle.slice(0, 30))}`) }).first();
      await j.tabTo(card, { label: "job card" });
      await page.keyboard.press("Enter");
      const detail = await j.expectDialogTookFocus("job detail");
      await j.step("job detail open");
      await j.tabStaysInDialog(6, "job detail");

      const apply = detail.getByRole("button", { name: /^(apply|continue|book)\b/i }).first();
      await j.tabTo(apply, { label: "apply button" });
      await page.keyboard.press("Enter");
      const confirm = await j.expectDialogTookFocus("apply sheet");
      await j.step("apply sheet open");
      const send = confirm.getByRole("button", { name: /^(apply now|book now)$/i }).first();
      await j.tabTo(send, { label: "Apply Now" });
      await page.keyboard.press("Enter");
      await expect(page.getByText(/application sent|you're booked/i).first()).toBeVisible({ timeout: 10_000 });
      await j.step("applied", undefined, { allowBodyFocus: false });

      // Whatever is still open closes on Escape and hands focus back to a real control.
      for (let i = 0; i < 3; i++) {
        const open = page.locator('[role="dialog"][data-state="open"]').last();
        if (!(await open.count())) break;
        await j.escapeDialog(open, null, `close remaining dialog ${i + 1}`);
      }
      await j.step("back on the feed");
      report(j);
    });

    test("post a job with photos — by keyboard", async ({ page, context, baseURL }, info) => {
      const j = new Journey(page, info, mode);
      await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
      await installSupabaseMocks(page, {
        user: FAKE_CUSTOMER,
        rules: [mockRpc("get_public_platform_settings", [{ helper_fee_percent: 10 }]), mockTable("jobs", [])],
      });

      await page.goto("/post-job");
      await expect(page.getByRole("heading", { name: /post a job/i })).toBeVisible({ timeout: 15_000 });
      await j.step("post-job entry", undefined, { allowBodyFocus: true });
      await j.tabTo(page.getByRole("button", { name: /start fresh/i }), { label: "Start fresh" });
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { name: /job details/i })).toBeVisible({ timeout: 10_000 });
      await j.step("post-job form", undefined, { allowBodyFocus: true });

      await j.tabAndType(page.locator("#title"), "Move a couch up one flight", "title");
      await j.tabAndType(page.locator("#description"), "Two-seater sofa from the truck to a second-floor apartment. Two people needed.", "description");
      const category = page.getByRole("button", { name: /^moving$/i }).first();
      await j.tabTo(category, { label: "category chip" });
      await page.keyboard.press("Enter");
      await expect(category).toHaveAttribute("aria-pressed", "true");

      // Photos — the input is reached by Tab and opened by Space; two files.
      const photoInput = page.locator('input[type="file"][accept="image/*"]').first();
      await j.tabAndChooseFiles(photoInput, [photo("one.png"), photo("two.png")], "job photos");
      await expect(page.locator("img[alt*='photo' i], img[src^='blob:']").first()).toBeVisible({ timeout: 5_000 });
      await j.step("details filled with photos");

      await j.tabAndType(page.locator("#streetAddress"), "123 Magazine St", "street");
      await j.tabAndType(page.locator("#city"), "New Orleans", "city");
      await page.keyboard.press("Escape"); // dismiss any suggestion list
      await j.tabAndType(page.locator("#zipCode"), "70130", "ZIP");
      await j.tabTo(page.locator("#date"), { label: "date needed" });
      await pickDateByKeyboard(j, page.locator("#date"), "date needed", { daysAhead: 3 });
      // Start time: the phone wheels are scrollable listboxes; arrow keys scroll and commit.
      const hour = page.getByRole("listbox", { name: /hour/i }).first();
      await j.tabTo(hour, { label: "hour wheel" });
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowDown");
      const period = page.getByRole("radio", { name: /^pm$/i }).or(page.getByRole("button", { name: /^pm$/i })).first();
      if (await period.count()) {
        await j.tabTo(period, { label: "PM" });
        await page.keyboard.press("Enter");
      }
      await j.step("logistics filled");
      await j.tabAndType(page.locator("#budget"), "120", "budget");
      const review = page.getByRole("button", { name: /review & pay/i }).first();
      await expect(review, "the submit never became 'Review & Pay' — a required field was not accepted").toBeVisible({ timeout: 5_000 });
      await j.tabTo(review, { label: "Review & Pay" });
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { name: /order summary/i })).toBeVisible({ timeout: 10_000 });
      await j.step("checkout reached", undefined, { allowBodyFocus: true });
      report(j);
    });

    test("read a thread and reply — by keyboard", async ({ page, context, baseURL }, info) => {
      const j = new Journey(page, info, mode);
      await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
      await installSupabaseMocks(page, { user: FAKE_CUSTOMER, seed: true });

      await page.goto("/messages");
      const row = page.locator("button").filter({ hasText: SEED_JOBS[1].title.slice(0, 40) }).first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      await j.step("inbox", undefined, { allowBodyFocus: true });
      await j.tabTo(row, { label: "conversation row" });
      await page.keyboard.press("Enter");
      const composer = page.getByRole("textbox", { name: /type a message/i });
      await expect(composer).toBeVisible({ timeout: 10_000 });
      await j.step("thread open");
      await j.tabAndType(composer, "Replying with the keyboard only.", "composer");
      await page.keyboard.press("Enter");
      await expect(page.getByText("Replying with the keyboard only.").first()).toBeVisible({ timeout: 10_000 });
      await j.step("reply sent");
      report(j);
    });

    test("change a notification setting, then sign out — by keyboard", async ({ page, context, baseURL }, info) => {
      const j = new Journey(page, info, mode);
      await seedAuthedSession(context, FAKE_CUSTOMER, baseURL ?? "");
      await installSupabaseMocks(page, {
        user: FAKE_CUSTOMER,
        rules: [
          mockTable("notification_preferences", [{ user_id: FAKE_CUSTOMER.id, push_enabled: true, email_enabled: true }]),
          mockTable("push_tokens", []),
        ],
      });

      await page.goto("/profile?tab=notifications");
      const master = page.getByRole("switch", { name: /push notifications master toggle/i });
      await expect(master).toBeVisible({ timeout: 15_000 });
      await expect(master).toBeEnabled({ timeout: 10_000 });
      await j.step("notification settings", undefined, { allowBodyFocus: true });
      const before = await master.getAttribute("aria-checked");
      const write = page.waitForRequest(
        (r) => r.url().includes("/rest/v1/notification_preferences") && ["PATCH", "POST"].includes(r.method()),
        { timeout: 10_000 },
      );
      await j.tabTo(master, { label: "push master switch" });
      await page.keyboard.press("Space");
      await write;
      await expect(master).toHaveAttribute("aria-checked", before === "true" ? "false" : "true");
      await j.step("setting changed");

      // Sign out: the confirm dialog opens, Escape returns focus, then confirm for real.
      await page.goto("/profile");
      const logout = page.getByRole("button", { name: /^log out$/i }).first();
      await expect(logout).toBeVisible({ timeout: 15_000 });
      await j.step("profile", undefined, { allowBodyFocus: true });
      await j.tabTo(logout, { label: "Log Out" });
      await page.keyboard.press("Enter");
      const dialog = await j.expectDialogTookFocus("log out dialog");
      await j.step("log out dialog");
      await j.tabStaysInDialog(5, "log out dialog");
      await j.escapeDialog(dialog, logout, "log out dialog");
      await page.keyboard.press("Enter");
      const dialog2 = await j.expectDialogTookFocus("log out dialog (again)");
      await j.tabTo(dialog2.getByRole("button", { name: /^log out$/i }), { label: "confirm Log Out" });
      await page.keyboard.press("Enter");
      await page.waitForURL((u) => !/\/profile/.test(u.pathname), { timeout: 15_000 });
      await j.step("signed out", undefined, { allowBodyFocus: true });
      report(j);
    });
  });
}

// --- Shared keyboard idioms -----------------------------------------------------------

/**
 * DatePickerField by keyboard: Enter on the trigger opens a popover dialog
 * ("Choose a date"). Two bodies exist — a react-day-picker calendar (job date;
 * autoFocus lands on a day, arrows move, Enter picks) and a wheel (DOB, has a
 * maxDate; its options are buttons). Either way the popover closes on pick
 * and the trigger must show a value.
 */
async function pickDateByKeyboard(j: Journey, trigger: Locator, label: string, opts: { daysAhead?: number } = {}): Promise<void> {
  const { page } = j;
  await page.keyboard.press("Enter");
  const popover = page.getByRole("dialog", { name: /choose a date/i });
  await expect(popover, `${label}: date popover did not open`).toBeVisible({ timeout: 10_000 });
  const grid = popover.getByRole("grid");
  if (await grid.count()) {
    // Calendar: focus is on a day cell already (autoFocus). Move ahead and pick.
    await expect.poll(async () => (await page.evaluate(probeFocus)).inDialog, { message: `${label}: focus not in the calendar` }).toBe(true);
    for (let i = 0; i < (opts.daysAhead ?? 2); i++) await page.keyboard.press("ArrowRight");
    await j.assertFocusOk(`${label}: calendar day`);
    await page.keyboard.press("Enter");
  } else {
    // Wheel: Tab to the first option button of each wheel and pick the one in the band.
    const wheels = popover.getByRole("listbox");
    const n = await wheels.count();
    expect(n, `${label}: wheel popover has no listboxes`).toBeGreaterThan(0);
    for (let w = 0; w < n; w++) {
      const selected = wheels.nth(w).getByRole("option", { selected: true }).first();
      const target = (await selected.count()) ? selected : wheels.nth(w).getByRole("option").first();
      await j.tabTo(target, { label: `${label}: wheel ${w + 1}` });
      await page.keyboard.press("Enter");
    }
    if (await popover.isVisible()) {
      const done = popover.getByRole("button", { name: /done|confirm|set|ok/i }).first();
      if (await done.count()) {
        await j.tabTo(done, { label: `${label}: done` });
        await page.keyboard.press("Enter");
      } else {
        await page.keyboard.press("Escape");
      }
    }
  }
  await expect(popover, `${label}: popover still open after picking`).toBeHidden({ timeout: 5_000 });
  const back = await trigger.evaluate((e) => document.activeElement === e).catch(() => false);
  expect(back, `${label}: focus did not return to the date field after the popover closed`).toBe(true);
  await expect(trigger, `${label}: no date shown after picking`).not.toHaveText(/select a date|^\s*$/i);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function report(j: Journey): void {
  if (j.notes.length) console.log(`[assistive · ${j.mode.name}] ${j.info.title}\n  ${j.notes.join("\n  ")}`);
}
