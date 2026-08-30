import { type RefObject } from "react";
import {
  Filter,
  Inbox,
  Briefcase,
  CheckCheck,
} from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
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
  /**
   * The nav tab that was long-pressed — set fresh at press time (see
   * MobileNav's quickActionAnchorRef / TabButton). Unlike Filters or the
   * bell, this trigger has no single fixed position: it's whichever of the
   * four long-pressable tabs the user pressed, so the ref is repointed on
   * every open rather than created once.
   */
  anchorRef: RefObject<HTMLElement | null>;
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
const titles: Record<Exclude<QuickActionTab, null>, string> = {
  "/dashboard": "Browse Jobs",
  "/messages": "Messages",
  "/my-posts": "Posts",
  "/my-jobs": "Jobs",
};

export const QuickActionSheet = ({ quickActionTab, onClose, quickActions, anchorRef }: QuickActionSheetProps) => (
  <Popover open={quickActionTab !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
    <PopoverAnchor virtualRef={anchorRef} />
    <PopoverContent
      align="center"
      side="top"
      sideOffset={8}
      collisionPadding={16}
      aria-label={quickActionTab ? titles[quickActionTab] : "Quick actions"}
      className="w-[240px] max-w-[calc(100vw-2rem)] p-4 rounded-ds-lg bg-premium-page"
      // The long-pressed tab is OUTSIDE this popover subtree, so Radix
      // counts the tap that CLOSES it as an outside-interaction on that
      // same element — harmless here since long-press has no ordinary tap
      // handler that would re-toggle it, but guarded anyway for the same
      // reason FilterSheet / AttachSourceSheet guard their anchors.
      onInteractOutside={(e) => {
        const target = e.target as Node | null;
        if (target && anchorRef.current?.contains(target)) e.preventDefault();
      }}
    >
      {quickActionTab && (
        <p
          className="font-display italic font-bold leading-tight mb-3"
          style={{ fontSize: "clamp(1.05rem, 1.3vw + 0.4rem, 1.2rem)", color: "hsl(var(--ink-deep))", letterSpacing: "-0.02em" }}
        >
          {titles[quickActionTab]}
        </p>
      )}
      {quickActionTab === "/dashboard" && (
        <div className="flex flex-col gap-2">
          <QuickActionRow icon={Filter} label="Open filter chips" onClick={quickActions.browseFilters} />
        </div>
      )}
      {quickActionTab === "/messages" && (
        <div className="flex flex-col gap-2">
          <QuickActionRow icon={CheckCheck} label="Mark all read" onClick={quickActions.markAllRead} />
        </div>
      )}
      {quickActionTab === "/my-posts" && (
        <div className="flex flex-col gap-2">
          <QuickActionRow icon={Inbox} label="Posted jobs" onClick={quickActions.goPosted} />
          <QuickActionRow icon={Briefcase} label="Applied jobs" onClick={quickActions.goApplied} />
        </div>
      )}
      {quickActionTab === "/my-jobs" && (
        <div className="flex flex-col gap-2">
          <QuickActionRow icon={Inbox} label="Posted jobs" onClick={quickActions.goPosted} />
          <QuickActionRow icon={Briefcase} label="Applied jobs" onClick={quickActions.goApplied} />
        </div>
      )}
    </PopoverContent>
  </Popover>
);
