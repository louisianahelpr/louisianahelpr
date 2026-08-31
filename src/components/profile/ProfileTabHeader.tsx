import PageHeader from "@/components/PageHeader";
import type { ReactNode } from "react";

interface ProfileTabHeaderProps {
  title: string;
  /**
   * Tab callers pass this — a Profile tab returns to the Profile landing by
   * flipping local state, not by navigating, so there is no route to go "back"
   * to. Standalone routes rendered through <AppPage> pass `backTo` instead.
   */
  onBack?: () => void;
  /**
   * Fallback route for the back chevron when there is no in-app history.
   * Used by <AppPage> for the standalone sub-screens (Host Automation, Gift
   * Card, Benefits) that share this header with the Profile tabs. Prefer it
   * over an `onBack` handler on a real route: an onClick short-circuits
   * BackButton's history pop and turns "back" into a forward push.
   */
  backTo?: string;
  rightSlot?: ReactNode;
}

/**
 * The Profile tabs' page title — a THIN forward to the app-wide `<PageHeader>`.
 *
 * It used to hand-roll its own `<BackButton/> + <h1>` row, which made it a
 * second, competing title treatment: the h1 inlined
 * `clamp(1.4rem, 2vw + 0.4rem, 1.75rem)` instead of the shared `.text-page-title`
 * utility every other page's heading uses, so the eighteen Profile tabs were
 * the only screens in the app whose title was a different size from the rest.
 * Owner approved the convergence (and the resulting size change) on 2026-08-29.
 *
 * This file adds NO markup, padding or margin of its own — deliberately. It is
 * kept (rather than inlining `<PageHeader>` at all fourteen call sites) only
 * because it maps the tabs' local prop names onto PageHeader's, and because
 * `profileTabShell.test.ts` asserts the shared tab shell by locating
 * `<ProfileTabHeader` in each tab component. Add nothing here.
 *
 * Two PageHeader options are load-bearing:
 *  - `width="none"`: Profile.tsx already wraps every tab in
 *    `container mx-auto px-5 lg:px-8 xl:px-12` > `page-measure mx-auto`. Any
 *    container here would be a SECOND max-width + gutter.
 *  - `topInsetHandled`: the tabs render inside `<AppShell className="pt-safe-top">`,
 *    which has already cleared the notch. Without this flag PageHeader absorbs
 *    `var(--safe-area-top)` again and every tab title drops by a full inset.
 *
 * The old `mb-3` on the title row is gone: PageHeader owns both gaps (`pt-6 pb-6`,
 * 24px each side) and bodies contribute neither.
 *
 * ONE exception, and it lives here rather than on the shell: every tab's
 * outer wrapper is `space-y-4` (asserted byte-for-byte in
 * `profileTabShell.test.ts`, no room for a `pb-0` variant), which puts its
 * own `margin-top: 1rem` on whatever follows this header — stacking a second
 * 16px onto PageHeader's own bottom padding and making the gap below the
 * title larger than the one above it. Padding never collapses with a
 * sibling's margin, so nesting alone can't cancel it. `-mb-4` on this wrapper
 * DOES collapse against that `space-y-4` margin (adjoining margins net to
 * their sum: 16px + -16px = 0), leaving PageHeader's own padding as the only
 * contributor below the title, equal to the one above it.
 *
 * `-mb-4` is keyed to the SHELL's `space-y-4` (16px), NOT to PageHeader's
 * padding — so it stays correct when that padding changes (it did, 16 → 24).
 * If the shared tab shell ever stops being `space-y-4`, this number moves
 * with it. This is the one place allowed to touch spacing outside PageHeader
 * itself, because the alternative is loosening the shell test's exact-match
 * guard for every tab.
 */
export function ProfileTabHeader({ title, onBack, backTo, rightSlot }: ProfileTabHeaderProps) {
  return (
    <div className="-mb-4">
      <PageHeader
        title={title}
        onBack={onBack}
        backTo={backTo}
        titleActions={rightSlot}
        width="none"
        topInsetHandled
      />
    </div>
  );
}

export default ProfileTabHeader;
