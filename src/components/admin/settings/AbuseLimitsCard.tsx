import type { Dispatch, SetStateAction } from "react";
import { Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdminCard } from "../AdminViewShell";
import { ABUSE_LIMITS, allCapsOff, type AbuseLimitKey } from "../abuseLimits";

/** Admin -> Settings: the Abuse Limits card (moved verbatim out of AdminSettings.tsx, Q806).
 *  The state, the live preview and the save all stay in AdminSettings; this is only the markup. */
export function AbuseLimitsCard({
  savedCaps,
  capInputs,
  setCapInputs,
  capPreview,
  handleSaveCaps,
  savingCaps,
  settingsId,
}: {
  savedCaps: Partial<Record<AbuseLimitKey, number | null>>;
  capInputs: Record<AbuseLimitKey, string>;
  setCapInputs: Dispatch<SetStateAction<Record<AbuseLimitKey, string>>>;
  capPreview: (key: AbuseLimitKey) => string;
  handleSaveCaps: () => void;
  savingCaps: boolean;
  settingsId: string | null;
}) {
  return (
    <AdminCard
      title={<span className="flex items-center gap-2"><Gauge className="w-4 h-4 text-primary" /> Abuse Limits</span>}
      subtitle="Blank or 0 means NO LIMIT. All four ship off — turn one on only while you are working an abuse wave, and turn it back off after."
      contentClassName="space-y-4"
    >
      {allCapsOff(savedCaps) && (
        <div className="rounded-ds-md border border-border bg-muted/40 p-3">
          <p className="text-ds-11 text-muted-foreground leading-relaxed">
            All four limits are off, which is the intended default — a Helpr
            can send any number of applications and signups are unthrottled.
            That also means <span className="font-semibold text-foreground">there is no automated abuse protection on either
            path</span>; a script can apply to every open job or hammer signup
            until you set a number here.
          </p>
        </div>
      )}
      <div className="space-y-3">
        {ABUSE_LIMITS.map((limit) => (
          <div key={limit.key} className="space-y-1.5">
            <Label htmlFor={limit.key}>{limit.label}</Label>
            <div className="flex items-center gap-3">
              <Input
                id={limit.key}
                type="number"
                inputMode="numeric"
                min={0}
                placeholder="No limit"
                className="max-w-[9rem]"
                value={capInputs[limit.key] ?? ""}
                onChange={(e) =>
                  setCapInputs((prev) => ({ ...prev, [limit.key]: e.target.value }))
                }
              />
              <span className="text-ds-11 text-muted-foreground">{capPreview(limit.key)}</span>
            </div>
            <p className="text-ds-11 text-muted-foreground leading-tight">{limit.description}</p>
            <p className="text-ds-10 text-muted-foreground font-mono">{limit.key}</p>
          </div>
        ))}
      </div>
      <Button onClick={handleSaveCaps} disabled={savingCaps || !settingsId}>
        {savingCaps ? "Saving…" : "Save Abuse Limits"}
      </Button>
    </AdminCard>
  );
}
