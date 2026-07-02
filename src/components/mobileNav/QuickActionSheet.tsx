import {
  Filter,
  Inbox,
  Briefcase,
  Users as UsersIcon,
  CheckCheck,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { QuickActionRow } from "./QuickActionRow";

export type QuickActionTab = null | "/dashboard" | "/messages" | "/my-posts" | "/my-jobs" | "/profile";

interface QuickActions {
  browseFilters: () => void;
  markAllRead: () => void;
  goPosted: () => void;
  goApplied: () => void;
  switchAccountPlaceholder: () => void;
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
 */
export const QuickActionSheet = ({ quickActionTab, onClose, quickActions }: QuickActionSheetProps) => (
  <Sheet open={quickActionTab !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
    <SheetContent side="bottom" className="rounded-t-2xl">
      {quickActionTab === "/dashboard" && (
        <>
          <SheetHeader className="text-left">
            <SheetTitle>Browse jobs</SheetTitle>
            <SheetDescription>Quick filters for the feed.</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-2 mt-6">
            <QuickActionRow icon={Filter} label="Open filter chips" onClick={quickActions.browseFilters} />
          </div>
        </>
      )}
      {quickActionTab === "/messages" && (
        <>
          <SheetHeader className="text-left">
            <SheetTitle>Messages</SheetTitle>
            <SheetDescription>Inbox quick actions.</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-2 mt-6">
            <QuickActionRow icon={CheckCheck} label="Mark all read" onClick={quickActions.markAllRead} />
          </div>
        </>
      )}
      {quickActionTab === "/my-posts" && (
        <>
          <SheetHeader className="text-left">
            <SheetTitle>Posts</SheetTitle>
            <SheetDescription>Jump straight to a tab.</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-2 mt-6">
            <QuickActionRow icon={Inbox} label="Posted jobs" onClick={quickActions.goPosted} />
            <QuickActionRow icon={Briefcase} label="Applied jobs" onClick={quickActions.goApplied} />
          </div>
        </>
      )}
      {quickActionTab === "/my-jobs" && (
        <>
          <SheetHeader className="text-left">
            <SheetTitle>Jobs</SheetTitle>
            <SheetDescription>Jump straight to a tab.</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-2 mt-6">
            <QuickActionRow icon={Inbox} label="Posted jobs" onClick={quickActions.goPosted} />
            <QuickActionRow icon={Briefcase} label="Applied jobs" onClick={quickActions.goApplied} />
          </div>
        </>
      )}
      {quickActionTab === "/profile" && (
        <>
          <SheetHeader className="text-left">
            <SheetTitle>Profile</SheetTitle>
            <SheetDescription>Account quick actions.</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-2 mt-6">
            <QuickActionRow icon={UsersIcon} label="Switch account" onClick={quickActions.switchAccountPlaceholder} />
          </div>
        </>
      )}
    </SheetContent>
  </Sheet>
);
