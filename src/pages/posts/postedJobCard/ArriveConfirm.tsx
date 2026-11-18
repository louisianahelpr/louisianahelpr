import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { t } from "@/lib/i18n/language";
import "@/lib/i18n/enJobPoster";

/**
 * Area 03 M8 (design audit 11-18): "Confirm" arrival asks "Did Hallie arrive?" first; it fired in one tap. The write is
 * the card's own confirmArrival (PostedJobCard's onPrimary). Guard: src/test/area03JobsPoster.test.tsx.
 */
export function ArriveConfirm({ open, first, onClose, onPrimary }: { open: boolean; first: string; onClose: () => void; onPrimary: () => void }) {
  return (
    <div data-arrive-confirm-host="" onClick={(e) => e.stopPropagation()}>
      <BrandConfirmDialog
        open={open}
        onOpenChange={(o) => { if (!o) onClose(); }}
        title={first ? t("jp.arriveTitle", { name: first }) : t("jp.arriveTitleNoName")}
        description={t("jp.arriveBody")}
        primaryLabel={t("jp.arriveYes")}
        onPrimary={onPrimary}
        secondaryLabel={t("jp.arriveNo")}
      />
    </div>
  );
}
