# Design system — "Warm Modern" (owner, 2026-10-17)

The owner picked direction **C "Warm Modern"** (mock-ups `mockups-1017/C2`):
warm neutrals, **green only** (`#0E7A4A`, no clay or rust), **flat buttons**,
one sans typeface. This file is the reference for the tokens in
`src/index.css` and the Tailwind theme in `tailwind.config.ts`. The values
below are read from those two files; if they disagree, the CSS wins and this
file is stale.

## Colour

Token names are older than the palette (`--bark`, `--burnt-sienna`,
`--olivewood`): they were kept so hundreds of call sites follow the new values
without edits. New code uses the role names in the first column.

| Role | Token | Light | Dark |
|---|---|---|---|
| Brand fill (primary buttons, selected controls, completed rail pips) | `--brand` | `#0E7A4A` | `#0E7A4A` (same in both themes) |
| Label on the brand fill | `--brand-foreground` | white | white |
| Green as text / icon | `--brand-ink` (= `--bark`) | `#0E7A4A` | `#4CC38A` |
| Accent (old sienna role, now green) | `--burnt-sienna`, `--accent-ink`, `--sienna-ink` | `#0E7A4A` | mint (`--sienna-ink` slightly lighter) |
| Page canvas | `--parchment` | `#F7F3EC` | `#0F1412` |
| Card | `--ivory-sand` | `#FFFFFF` | `#19201C` |
| Quiet surface (chips, filter discs) | `--sand` | `#EFE9DF` | `#232C27` |
| Primary text | `--olivewood` | `#1D2420` | `#EEF1EC` |
| Muted text | `--stormy-sky` (`--muted-foreground`) | `#646960` | `#9AA59E` |
| Hairline | `--border` | `#E3DCD0` | `#2A342E` |
| Danger | `--destructive` | `#C23422` | `#C23422` |

Contrast, measured with the WCAG formula: white on `#0E7A4A` 5.38:1;
`#4CC38A` on `#0F1412` 8.4:1; `#0E7A4A` on `#0F1412` only 3.46:1, which is why
dark mode uses the mint for green TEXT while the button fill stays `#0E7A4A`.
The mock's muted `#6B706A` measured 4.19:1 on `--sand`, so muted text is one
step darker (`#646960`: 4.66:1 on `--sand`, 5.09:1 on the page).

**No alpha-dimmed text below AA.** `src/test/lowAlphaForegroundContrast.test.ts`
composites every `colour/alpha` foreground onto the real surfaces; on the
warmer page `--accent-ink/0.9` fell to 4.08:1, so those sites use the full ink.

## Buttons: flat

- `.btn-grad-primary` (the name is historical) is `background-color:
  hsl(var(--brand))`, `background-image: none`, white label (it scopes
  `--parchment` to `--brand-foreground`, so every `text-[hsl(var(--parchment))]`
  label on a CTA is white in both themes).
- `<Button>` variants carry **no shadow, no inner highlight, no gradient**;
  the only treatment left is the press (`active:scale-[0.97]`).
- Tests assert the COMPUTED fill (`background-image: none`,
  `background-color: rgb(14, 122, 74)`), never the class name
  (`src/test/glossyPrimaryInvariant.test.ts`,
  `src/test/segmentedControlInvariant.test.tsx`,
  `src/test/railGreenMatchesPrimary.test.ts`,
  `e2e/happy-path/apply-single-sheet.spec.ts`).

## Type

- **One sans: Plus Jakarta Sans** (self-hosted `public/fonts/plus-jakarta-sans-*.woff2`,
  OFL, with a metric-matched fallback face). Tailwind `sans` and `display` both
  resolve to it. Montserrat is retired; `src/test/twoFontTypeSystem.test.tsx`
  fails if anything selects it again.
- **Bodoni Moda only as `font-hero`**, the landing H1 ("Louisiana's Local
  Partner.", "Partner." italic in `--brand-ink`).
- Scale: `--type-title` 25px / 700, `--type-heading` 18px / 700,
  `--type-body` 15px / 500, `--type-label` 14px / 600-700, `--type-meta` 13px / 500.

## Shape and depth

- Radius: `--radius-card` 24px, `--radius-control` pill (9999px).
- Two elevation levels: `--elev-rest` (cards) and `--elev-raised` (sheets and
  modals alias it). Shadows are warm (`rgba(60,40,20,…)`), never black.

## Logo

A slot. The owner is making the logo herself (she rejected the three mock
marks on 2026-10-17); the wordmark stays until her file arrives.

## Navigation (slice 2)

Bottom bar: **Home + Jobs & Posts + Declutter + Shops + Homes**, icons only, no
`+` in the bar. A section whose feature switch is off for the viewer is hidden
(the switch's audience is the owner's call, never changed by code). Each
section header carries its own labeled `+ Post` pill and its own Messages
button. Home is a hub with one preview row per section. Sections do not live
in the Profile landing (Profile = just you). The desktop right rail carries the
same set. Customising the bar (reorder / hide) is slice 3.
