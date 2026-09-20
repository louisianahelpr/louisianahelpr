import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * EVERY `min-[Npx]:` / `max-[Npx]:` CLASS THE APP SHIPS IS A REAL CSS RULE.
 *
 * ─── THE DEFECT THIS EXISTS FOR ────────────────────────────────────────────
 * Tailwind reads every file matched by `content` in tailwind.config.ts as raw
 * TEXT — `./src/**`, test files included — and treats anything class-shaped as
 * a candidate. A candidate that looks like an arbitrary variant but carries an
 * unparseable value does not merely fail to produce its own rule: it takes
 * THE ENTIRE VARIANT FAMILY down with it, project-wide, silently.
 *
 * On 2026-09-20 one line in src/test/activityTabLabelsFitAPhone.test.ts —
 * a guard asserting the Activity tab breakpoint by interpolating the
 * constant into the class name — put a `min-` glued to a bracketed
 * interpolation into a scanned file. Measured in `dist/assets/*.css` that
 * morning: zero `@media (min-width: 390px)` blocks, zero `(min-width: 500px)`,
 * zero 330 / 360 / 480 / 620 / 1024 / 1280. Re-measured by re-introducing that
 * one line under this guard: 40 of the 42 classes the app writes compile to
 * nothing — ScheduleTab's entire 1024px desktop layer, NotificationPreferences'
 * 360px rows, Footer's 500/620 column grid, ProfileEditForm, PetForm,
 * SavedHelperCard, JobTracking, JobCardMetaRow, CompleteProfile,
 * RecurringSchedulePicker, ScreenHeaderRow's `min-[500px]:block` title, and
 * the Activity tab row's short/long label swap — which is how a 414 phone came
 * to paint "You / Soon / Cancel" instead of the owner's five words.
 *
 * Nothing went red. Every source-level guard was green, including the one
 * that asserted the class name was present — because it WAS present. The
 * class was in the file; the rule was not in the stylesheet.
 *
 * ─── WHY THE CHECK IS SHAPED THIS WAY ──────────────────────────────────────
 * Both sides come from the world, neither is declared:
 *
 *   · the INVENTORY is scraped out of the app's own source — every
 *     `min-[Npx]:util` / `max-[Npx]:util` a component actually writes;
 *   · the ANSWER is produced by the app's REAL Tailwind over the app's REAL
 *     `content` globs, so a poisoning candidate anywhere under ./src fails
 *     here, in vitest, on the commit that introduces it.
 *
 * A list that is both the input and the oracle cannot fail. This one compares
 * what the components ask for against what the compiler emits, and the two
 * are produced by different machinery.
 *
 * ─── WHY IT IS NOT A LINT RULE ─────────────────────────────────────────────
 * Because the failure is not local. The offending text and the classes it
 * kills are in different files, often different features, and the only thing
 * that knows they are connected is the compiler. A lint rule could ban the
 * `min-` + interpolation spelling (worth having too), but it could never tell
 * you that a rule you rely on has stopped existing.
 */

// PROOF THIS GUARD CAN FAIL (npm run vacuity):
//   1. The content globs stop covering src/components, which is where most of
//      the inventory lives. Every class those files write is then missing from
//      the compiler's output while still being written in the source, and the
//      guard goes red naming them. A content glob that quietly stops matching
//      a directory is the OTHER way this app can ship class names that are not
//      rules — the negation already in that array is there for a reason, and
//      one more would do this.
//
//   NOT a mutation of the class literal itself, and the reason is worth
//   knowing: a @mutate directive restates its find-string inside this file,
//   which Tailwind also scans. Respelling `SHORT_ONLY_CLASS` here would leave
//   the class alive as a candidate in the directive line and the rule would
//   still be emitted — the mutation would die of the very effect this file
//   documents. The directives are content too.
// @mutate tailwind.config.ts | "!./src/test/edge/**", | "!./src/components/**",

const ROOT = resolve(__dirname, "../..");

/** The app's own source — not the tests, which are scanned but ship nothing. */
const SRC_DIRS = ["src/components", "src/pages", "src/lib", "src/hooks"];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/**
 * Every arbitrary width variant the app writes, and where.
 *
 * The utility part is deliberately permissive — `grid-cols-3`, `text-ds-12`,
 * `gap-x-4`, `inline-block` — because what matters is the SELECTOR Tailwind
 * will emit for it, and that is the whole candidate.
 */
const CANDIDATE = /\b(min|max)-\[(\d+)px\]:([a-zA-Z0-9][a-zA-Z0-9_.\-/]*)/g;

type Use = { cls: string; kind: "min" | "max"; px: number; util: string; where: string };

const USES: Use[] = (() => {
  const seen = new Map<string, Use>();
  for (const dir of SRC_DIRS) {
    for (const file of walk(resolve(ROOT, dir))) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(CANDIDATE)) {
        const cls = m[0];
        if (!seen.has(cls)) {
          seen.set(cls, {
            cls,
            kind: m[1] as "min" | "max",
            px: Number(m[2]),
            util: m[3],
            where: relative(ROOT, file),
          });
        }
      }
    }
  }
  return [...seen.values()].sort((a, b) => a.cls.localeCompare(b.cls));
})();

/** Tailwind escapes `[`, `]`, `:`, `.` and `/` in the selector it emits. */
const selectorFor = (u: Use) =>
  `.${u.kind}-\\[${u.px}px\\]\\:${u.util.replace(/[.:/]/g, (c) => `\\${c}`)}`;

let CSS = "";

describe("every arbitrary width variant in the app compiles to a rule", () => {
  it("the inventory is real, and came from the components", () => {
    // VACUITY FLOOR (class a): an empty inventory would make the assertion
    // below true of nothing. 40 distinct classes were dead on 2026-09-20; the
    // floor is deliberately well under that so removing one feature does not
    // fail the wrong test, and well over zero.
    expect(USES.length).toBeGreaterThan(20);
    expect(USES.some((u) => u.kind === "max")).toBe(true);
    expect(new Set(USES.map((u) => u.where)).size).toBeGreaterThan(2);
  });

  it(
    "each one is emitted, under the media query its name promises",
    async () => {
      /* The app's own compiler and the app's own content globs. The config
         comes in by PATH because tailwind.config.ts is not a file
         tsconfig.app.json lists, and a variable specifier is resolved by the
         runtime and left alone by tsc. */
      const configPath = resolve(ROOT, "tailwind.config.ts");
      const [{ default: postcss }, { default: tailwindcss }, { default: config }] =
        await Promise.all([
          import("postcss"),
          import("tailwindcss"),
          import(/* @vite-ignore */ configPath) as Promise<{ default: unknown }>,
        ]);
      CSS = (
        await postcss([tailwindcss(config as never)]).process("@tailwind utilities;", {
          from: undefined,
        })
      ).css;

      const missing = USES.filter((u) => !CSS.includes(selectorFor(u)));
      expect(
        missing.map((u) => `${u.cls}  (${u.where})`),
        missing.length
          ? `${missing.length} of ${USES.length} arbitrary width variants compile to NO CSS ` +
            `RULE. If that is most or all of them, the cause is almost certainly a single ` +
            `poisoned candidate rather than ${missing.length} separate mistakes: search ` +
            `./src (tests and comments included — Tailwind scans them) for a "min-" or ` +
            `"max-" immediately followed by a bracket that is not a literal pixel value, ` +
            `such as a template interpolation. One of those disables the whole variant ` +
            `family for the entire app, in silence, while every class name stays exactly ` +
            `where it was.`
          : "",
      ).toEqual([]);

      // And under the RIGHT query — a rule that exists at the wrong width is
      // the same defect wearing the answer's clothes.
      for (const u of USES) {
        const at = u.kind === "min" ? "min-width" : "max-width";
        expect(
          CSS,
          `${u.cls} (${u.where}) is emitted, but not under @media (${at}: ${u.px}px).`,
        ).toMatch(
          new RegExp(
            `@media\\s*\\(${at}:\\s*${u.px}px\\)[\\s\\S]{0,20000}?` +
              selectorFor(u).replace(/[.\\[\]:/]/g, "\\$&"),
          ),
        );
      }
    },
    150_000,
  );
});
