import type { ComponentType, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { EmptyState, MAIN_TAB_EMPTY_BODY_LINES } from "@/components/ui/EmptyState";
import { BarkPillButton } from "@/components/ui/BarkPillButton";

/**
 * What a Declutter / Shops / Homes inbox tab shows while it has no threads (useMessageSections). `Lead` is a
 * section's own list that is not message threads (Declutter's order chats, DeclutterOrderTalkInbox): drawn above the
 * chip's threads, and given the empty state to show in its place only when it has nothing either.
 */
export type SectionEmpty = {
  icon: LucideIcon; title: string; body: string; action?: { label: string; to: string };
  Lead?: ComponentType<{ empty: ReactNode }>;
};

/** The same EmptyState box as the Jobs inbox's, with the section's own icon and words. */
export function SectionInboxEmpty({ empty, onGo }: { empty: SectionEmpty; onGo: (to: string) => void }) {
  const box = (
    <EmptyState
      icon={empty.icon}
      title={empty.title}
      bodyLines={MAIN_TAB_EMPTY_BODY_LINES} body={empty.body}
      action={empty.action ? <BarkPillButton onClick={() => onGo(empty.action!.to)}>{empty.action.label}</BarkPillButton> : undefined}
    />
  );
  return empty.Lead ? <empty.Lead empty={box} /> : box;
}
