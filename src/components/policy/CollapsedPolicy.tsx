import { useState } from "react";
import { ChevronDown, ChevronRight, type LucideIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export type PolicyRow = {
  icon: LucideIcon;
  title: string;
  body: React.ReactNode;
  warning?: boolean;
};

export const PolicyRowItem = ({ icon: Icon, title, body, warning }: PolicyRow) => {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className={`group w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-left transition-colors btn-press ${warning ? "hover:bg-destructive/10" : "hover:bg-primary/5"}`}>
        <span className="flex items-center gap-2.5 min-w-0">
          <span className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center ${warning ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}>
            <Icon className="w-3.5 h-3.5" strokeWidth={2.25} />
          </span>
          <span className="text-sm font-semibold text-foreground truncate">{title}</span>
        </span>
        <ChevronRight className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up overflow-hidden">
        <div className="px-3 pt-2 pb-3 text-sm text-muted-foreground space-y-1.5 border-l-2 border-border/40 ml-5 my-1">
          {body}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

export const PolicySection = ({ icon: Icon, title, subtitle, warning, defaultOpen = false, children }: { icon: LucideIcon; title: string; subtitle: string; warning?: boolean; defaultOpen?: boolean; children: React.ReactNode }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className={`rounded-2xl border squircle overflow-hidden transition-colors ${warning ? "border-destructive/20 bg-destructive/5" : "border-border bg-card"}`}>
        <CollapsibleTrigger className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left btn-press">
          <span className="flex items-center gap-3 min-w-0">
            <span className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${warning ? "bg-destructive/15 text-destructive" : "bg-primary/12 text-primary"}`}>
              <Icon className="w-4 h-4" strokeWidth={2.25} />
            </span>
            <span className="min-w-0">
              <p className="font-display font-bold text-foreground leading-tight text-base">{title}</p>
              <p className="text-[11px] text-muted-foreground truncate">{subtitle}</p>
            </span>
          </span>
          <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        </CollapsibleTrigger>
        <CollapsibleContent className="data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up overflow-hidden">
          <div className="px-2 pb-2 pt-1 space-y-0.5 border-t border-border/50">{children}</div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
};