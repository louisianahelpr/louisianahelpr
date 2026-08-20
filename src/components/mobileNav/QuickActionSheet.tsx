import {
  Filter,
  Inbox,
  Briefcase,
  CheckCheck,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHero,
} from "@/components/ui/sheet";
import { QuickActionRow } from "./QuickActionRow";

export type QuickActionTab = null | "/dashboard" | "/messages" | "/my-posts" | "/my-jobs";

interface QuickActions {
  browseFilters: () => void;
  markAllRead: () => void;
  goPosted: () => void;
  goApplied: () => void;
}

interface QuickActionSheetProps {
  quickActionTab: QuickActionTab;
  onClose: () => void;
  quickActions: QuickActions;
}

/**
 * Quick-action sheet — opens from a long-press on a tab. The sheet's
 * content is keyed by which tab triggered it; a single sheet keeps
 * the markup compact and the animation singular. Closing by tapping
 * outside, swiping down, or selecting an action all hit the same
 * `onClose` path. Extracted verbatim from MobileNav.
 *
 * Headers go through `SheetHero` like every other titled sheet. These four were
 * the app's only hand-rolled ones: they rendered Montserrat upright 18px/600 in
 * `--foreground` while all eleven `SheetHero` adopters render Bodoni italic
 * 19.2px in `--ink-deep`, so opening this sheet after any other one looked like
 * a different product. They were also the last sheets still stacking a subtitle
 * under the title, which the 2026-07-25 "one main title" decision removed
 * everywhere else — and each subtitle only restated its own title ("Browse
 * jobs" / "Quick filters for the feed"), so nothing was lost by dropping them.
 */
export const QuickActionSheet = ({ quickActionTab, onClose, quickActions }: QuickActionSheetProps) => (
  <Sheet open={quickActionTab !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
    <SheetContent side="bottom" className="rounded-t-2xl">
      {quickActionTab === "/dashboard" && (
        <>
          <SheetHero title="Browse jobs" />
          <div className="flex flex-col gap-2 mt-6">
            <QuickActionRow icon={Filter} label="Open filter chips" onClick={quickActions.browseFilters} />
          </div>
        </>
      )}
      {quickActionTab === "/messages" && (
        <>
          <SheetHero title="Messages" />
          <div className="flex flex-col gap-2 mt-6">
            <QuickActionRow icon={CheckCheck} label="Mark all read" onClick={quickActions.markAllRead} />
          </div>
        </>
      )}
      {quickActionTab === "/my-posts" && (
        <>
          <SheetHero title="Posts" />
          <div className="flex flex-col gap-2 mt-6">
            <QuickActionRow icon={Inbox} label="Posted jobs" onClick={quickActions.goPosted} />
            <QuickActionRow icon={Briefcase} label="Applied jobs" onClick={quickActions.goApplied} />
          </div>
        </>
      )}
      {quickActionTab === "/my-jobs" && (
        <>
          <SheetHero title="Jobs" />
          <div className="flex flex-col gap-2 mt-6">
            <QuickActionRow icon={Inbox} label="Posted jobs" onClick={quickActions.goPosted} />
            <QuickActionRow icon={Briefcase} label="Applied jobs" onClick={quickActions.goApplied} />
          </div>
        </>
      )}
    </SheetContent>
  </Sheet>
);
