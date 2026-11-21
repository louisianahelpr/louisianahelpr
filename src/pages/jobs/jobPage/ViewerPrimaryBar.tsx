/**
 * The job page's one button for anyone who is not the poster or the hired Helpr (Apply, View application, Open in
 * Jobs, Browse jobs), in the same sticky bar as the other rows (JP2). Out of JobPage.tsx for its 600-line cap.
 */
import { Button } from "@/components/ui/button";
import { StickyActionBar } from "@/components/ui/StickyActionBar";

export type ViewerPrimary = { label: string; go: () => void; gated?: { "aria-disabled"?: true; "data-age-gated"?: string } };

export function ViewerPrimaryBar({ primary }: { primary: ViewerPrimary }) {
  return (
    <StickyActionBar label="Job actions" data-job-bar="viewer" spacer={false}>
      <Button variant="primary" size="lg" className="w-full rounded-full text-ds-16" onClick={primary.go} {...(primary.gated ?? {})}>
        {primary.label}
      </Button>
    </StickyActionBar>
  );
}
