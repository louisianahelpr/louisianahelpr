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
 *    `container mx-auto px-5 lg:px-6 xl:px-6` > `page-measure mx-auto`. Any
 *    container here would be a SECOND max-width + gutter.
 *  - `topInsetHandled`: the tabs render inside `<AppShell className="pt-safe-top">`,
 *    which has already cleared the notch. Without this flag PageHeader absorbs
 *    `var(--safe-area-top)` again and every tab title drops by a full inset.
 *
 * The old `mb-3` on the title row is gone: PageHeader owns both gaps (`pt-6 pb-6`,
 * 24px each side) and bodies contribute neither.
 *
 * ONE exception, and it lives here rather than on the shell: every tab's
 * outer wrapper is `space-y-section` (asserted byte-for-byte in
 * `profileTabShell.test.ts`, no room for a `pb-0` variant), which puts its
 * own `margin-top: var(--section-gap)` on whatever follows this header — stacking a second
 * 16px onto PageHeader's own bottom padding and making the gap below the
 * title larger than the one above it. Padding never collapses with a
 * sibling's margin, so nesting alone can't cancel it. `-mb-[var(--section-gap)]`
 * on this wrapper DOES collapse against that margin (adjoining margins net to
 * their sum: gap + -gap = 0), leaving PageHeader's own padding as the only
 * contributor below the title, equal to the one above it.
 *
 * The negative margin reads the SHELL's own token (--section-gap, Q191), NOT
 * PageHeader's padding — so it stays correct when either changes. This is the one place allowed to touch spacing outside PageHeader
 * itself, because the alternative is loosening the shell test's exact-match
 * guard for every tab.
 */
export function ProfileTabHeader({ title, onBack, backTo, rightSlot }: ProfileTabHeaderProps) {
  return (
    <div className="-mb-[var(--section-gap)]">
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
