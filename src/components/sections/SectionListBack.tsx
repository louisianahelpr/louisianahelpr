import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * A phone's way back from one of a section's own lists (owner 11-08, the Vinted header: Buying, Selling, Posted,
 * Working and the rest left the top for the photo's "My …" sheet): the row under the search names the list and goes
 * back to Browse. Guard: src/test/declutterHeaderVinted.test.tsx.
 */
export function SectionListBack({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <div data-section-list-back="" className="flex h-11 items-center gap-1">
      <Button type="button" variant="ghost" size="iconCompact" aria-label="Back to Browse" onClick={onBack} className="-ml-2 text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-5 w-5" aria-hidden />
      </Button>
      <h2 className="min-w-0 truncate text-ds-18 font-semibold text-foreground">{label}</h2>
    </div>
  );
}
