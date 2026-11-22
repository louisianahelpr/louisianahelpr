import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The section's own soft "+ add" look (owner 2026-10-28: "the lighter green"): AppTopBar's SectionAddButton and the
 * guest Declutter "+ Sell something" (deep audit 11-22 #11) share it, so the two read as one button.
 */
// Design audit 11-17 #23: the bare 12% tint read as a grey, disabled pill beside the rail's olive "+ Create"; an olive
// edge makes it read as the lighter-green button it is (still no fill, no shadow: second to Create).
const SECTION_ADD_TINT = "rounded-full shadow-none border border-[hsl(var(--bark)/0.55)] bg-[hsl(var(--bark)/0.12)] text-[hsl(var(--bark))] ctl-tint-on-tint";
export const SECTION_ADD_CLS = `${SECTION_ADD_TINT} px-4 gap-1.5 font-semibold [&>svg]:w-[18px] [&>svg]:h-[18px]`;

/** A plain link in the section-add look, for a screen with no top bar of its own (a guest's Declutter). */
export function SectionAddLink({ to, label, className = "", ...data }: { to: string; label: string; className?: string } & Record<`data-${string}`, string>) {
  return (
    <Button asChild variant="ghost" size="sm" className={`${SECTION_ADD_CLS} shrink-0 ${className}`}>
      <Link to={to} {...data}><Plus aria-hidden />{label}</Link>
    </Button>
  );
}
