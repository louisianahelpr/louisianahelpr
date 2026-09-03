import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export const PriorityAlert = ({ label, count, color, onClick }: {
  label: string; count: number; color: "destructive" | "accent"; onClick: () => void;
}) => (
  <button
    onClick={onClick}
    className={cn(
      "flex items-center gap-2.5 rounded-ds-md border p-2.5 sm:p-3.5 text-left transition-all w-full hover:shadow-sm",
      color === "destructive"
        ? "border-destructive/30 bg-destructive/5 hover:bg-destructive/10"
        : "border-accent/30 bg-accent/5 hover:bg-accent/10"
    )}
  >
    <span className={cn(
      "w-8 h-8 sm:w-9 sm:h-9 rounded-ds-sm flex items-center justify-center text-ds-11 sm:text-ds-13 font-bold tabular-nums shrink-0",
      color === "destructive" ? "bg-destructive/15 text-destructive" : "bg-accent/20 text-[hsl(var(--accent-ink))]"
    )}>
      {count}
    </span>
    <span className="text-ds-11 sm:text-ds-13 font-semibold text-foreground flex-1 leading-tight">{label}</span>
    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
  </button>
);
