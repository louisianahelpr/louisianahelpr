import { lazy, Suspense, useState } from "react";
import { Flag } from "lucide-react";
import { IconActionButton } from "@/components/dashboard/IconActionButton";

const ReportDialog = lazy(() => import("@/components/ReportDialog"));
const BlockUserDialog = lazy(() => import("@/components/BlockUserDialog").then((m) => ({ default: m.BlockUserDialog })));

/**
 * F260j (audit 11-10): the job page had no Report or Block, only Help, so someone looking at a bad post had to go
 * back to the list to flag it. A flag icon beside Share opens the same Report sheet the job sheet uses (reportedType
 * "job"), with "Also block <name>" when the poster is still on the job; that hands over to the Block sheet.
 * Kept out of JobPage.tsx (near the 600-line cap).
 */
export function ReportJobControl({ jobId, posterId, posterFirst }: { jobId: string; posterId: string | null; posterFirst: string | null }) {
  const [reportOpen, setReportOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const name = posterFirst ?? "the person who posted it";
  return (
    <>
      <IconActionButton ariaLabel="Report this job" onClick={() => setReportOpen(true)} bare icon={<Flag className="w-4 h-4" />} />
      <Suspense fallback={null}>
        {reportOpen && (
          <ReportDialog
            open={reportOpen}
            onClose={() => setReportOpen(false)}
            reportedType="job"
            reportedId={jobId}
            alsoBlock={posterId ? { name, onBlock: () => setBlockOpen(true) } : undefined}
          />
        )}
        {blockOpen && posterId && (
          <BlockUserDialog open={blockOpen} onClose={() => setBlockOpen(false)} blockedUserId={posterId} blockedUserName={name} />
        )}
      </Suspense>
    </>
  );
}
