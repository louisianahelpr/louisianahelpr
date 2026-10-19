import type { LucideIcon } from "lucide-react";
import { EmptyState, MAIN_TAB_EMPTY_BODY_LINES } from "@/components/ui/EmptyState";
import { BarkPillButton } from "@/components/ui/BarkPillButton";

/** What a Declutter / Shops / Homes inbox tab shows while it has no threads (useMessageSections). */
export type SectionEmpty = { icon: LucideIcon; title: string; body: string; action?: { label: string; to: string } };

/** The same EmptyState box as the Jobs inbox's, with the section's own icon and words. */
export function SectionInboxEmpty({ empty, onGo }: { empty: SectionEmpty; onGo: (to: string) => void }) {
  return (
    <EmptyState
      icon={empty.icon}
      title={empty.title}
      bodyLines={MAIN_TAB_EMPTY_BODY_LINES} body={empty.body}
      action={empty.action ? <BarkPillButton onClick={() => onGo(empty.action!.to)}>{empty.action.label}</BarkPillButton> : undefined}
    />
  );
}
