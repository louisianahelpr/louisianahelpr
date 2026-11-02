import type { ComponentProps, ReactNode } from "react";
import { Link } from "react-router-dom";
import { Plus, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BarkPillButton } from "@/components/ui/BarkPillButton";

/**
 * The two ways out of an empty Browse, laid out one way for every section (owner 11-02, App Store 1.0.4: the Jobs and
 * Declutter empty Browse screens look the same): ONE green pill with a leading "+", then ONE quiet text link with a
 * leading icon under it. Jobs: "+ Post a job" / bell "Notify me when one lands". Declutter: "+ Sell something" /
 * search "Post what you're looking for".
 *
 * Each action is a link (`to`) or a press (`onClick`); `buttonProps` passes the age gate's grey-out (useAgeGate).
 * Guard: src/test/browseEmptyActionsOneLayout.test.tsx.
 */
type EmptyAction = {
  label: ReactNode;
  to?: string;
  onClick?: () => void;
  buttonProps?: Omit<ComponentProps<typeof Button>, "children" | "onClick" | "asChild">;
};

export function EmptyStateActions({ primary, secondary, secondaryIcon: SecondaryIcon }: {
  primary: EmptyAction;
  secondary?: EmptyAction | null;
  /** The quiet link's leading icon (Bell for Notify me, Search for Post what you're looking for). */
  secondaryIcon: LucideIcon;
}) {
  const plus = <Plus className="w-4 h-4 mr-1 shrink-0" strokeWidth={2.25} aria-hidden />;
  const quiet = <SecondaryIcon className="w-4 h-4 mr-1 shrink-0" strokeWidth={2.25} aria-hidden />;
  return (
    <div className="flex flex-col items-center gap-3" data-empty-actions="">
      {primary.to ? (
        <BarkPillButton asChild {...primary.buttonProps} data-empty-primary="">
          <Link to={primary.to}>{plus}{primary.label}</Link>
        </BarkPillButton>
      ) : (
        <BarkPillButton onClick={primary.onClick} {...primary.buttonProps} data-empty-primary="">
          {plus}{primary.label}
        </BarkPillButton>
      )}
      {secondary && (
        secondary.to ? (
          <Button asChild variant="ghost" size="wrap" className="font-sans font-medium max-w-full" style={{ color: "hsl(var(--olivewood) / 0.8)" }} data-empty-secondary="">
            <Link to={secondary.to}>{quiet}{secondary.label}</Link>
          </Button>
        ) : (
          <Button variant="ghost" size="wrap" onClick={secondary.onClick} className="font-sans font-medium max-w-full" style={{ color: "hsl(var(--olivewood) / 0.8)" }} data-empty-secondary="" {...secondary.buttonProps}>
            {quiet}{secondary.label}
          </Button>
        )
      )}
    </div>
  );
}
