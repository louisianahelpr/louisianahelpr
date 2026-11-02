import { Button } from "@/components/ui/button";
import { AdminCard } from "../AdminViewShell";

/**
 * Q2585: the way into the Declutter stage preview (/admin/preview/declutter), beside the other admin settings cards.
 * A plain link (a fresh page), so the preview's fetch layer starts on a clean page.
 */
export function DeclutterPreviewCard() {
  return (
    <AdminCard title="Declutter stage preview" subtitle="Every order stage, as the buyer or the seller sees it, on made-up data. Nothing is saved or sent.">
      <Button asChild variant="outline" size="sm" className="rounded-full">
        <a href="/admin/preview/declutter" data-declutter-preview-link="">Open the preview</a>
      </Button>
    </AdminCard>
  );
}
