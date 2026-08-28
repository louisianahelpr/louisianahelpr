import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChecklistItem {
  label: string;
  done: boolean;
}

interface ChecklistCardProps {
  checklist: ChecklistItem[];
  expanded: boolean;
  onToggle: () => void;
}

/**
 * Live "Big 7" checklist — collapsible on small viewports to save
 * vertical space on SE (375px). The header always shows progress
 * so the user isn't flying blind even when the list is folded.
 * On sm+ screens it's always expanded.
 */
export const ChecklistCard = ({ checklist, expanded, onToggle }: ChecklistCardProps) => (
  <div className="squircle mb-5 rounded-ds-lg border border-border/60 bg-card/80 backdrop-blur-md shadow-[var(--card-shadow)] p-4">
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls="profile-checklist"
      onClick={onToggle}
      className="w-full flex items-center justify-between sm:cursor-default"
    >
      <p className="text-ds-13 font-semibold text-foreground">Verification Checklist</p>
      <div className="flex items-center gap-2">
        <p className="text-ds-11 text-muted-foreground">
          {checklist.filter((c) => c.done).length}/{checklist.length}
        </p>
        {/* Chevron only visible on small screens where the list is togglable */}
        <ChevronDown
          className={cn(
            "w-4 h-4 text-muted-foreground transition-transform sm:hidden",
            expanded ? "rotate-180" : "",
          )}
          aria-hidden
        />
      </div>
    </button>
    {/* Always visible on sm+; toggled by button on xs */}
    <ul
      id="profile-checklist"
      className={cn(
        "space-y-1.5 mt-3 sm:block",
        expanded ? "block" : "hidden",
      )}
    >
      {checklist.map((item) => (
        <li key={item.label} className="flex items-center gap-2.5 text-ds-13">
          <span
            className={cn(
              "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
              item.done
                ? "bg-success/15 text-green-800 dark:text-green-400"
                : "bg-destructive/10 text-destructive",
            )}
            aria-hidden
          >
            {item.done ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
          </span>
          <span className={cn(item.done ? "text-muted-foreground line-through" : "text-foreground")}>
            {item.label}
          </span>
        </li>
      ))}
    </ul>
  </div>
);
