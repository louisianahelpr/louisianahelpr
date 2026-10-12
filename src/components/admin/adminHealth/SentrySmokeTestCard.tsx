import { Bug } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { confirmConsequential } from "@/lib/toastPolicy";
import { report } from "@/lib/errorLogger";
import { AdminCard } from "@/components/admin/AdminViewShell";

/** Sentry test, an admin-only sanity check. Moved out of AdminHealth.tsx
 *  unchanged so that screen stays under the 600-line component ceiling. */
export function SentrySmokeTestCard() {
  return (
    <AdminCard
      title={<span className="flex items-center gap-1.5"><Bug className="w-4 h-4 text-primary" /> Sentry Smoke Test</span>}
      subtitle="Fires a test exception; it should appear in Sentry within ~30 seconds."
    >
      <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              report(new Error(`Sentry smoke test (manual) — ${new Date().toISOString()}`), {
                severity: "info",
                tags: { source: "admin_smoke_test", kind: "manual" },
              });
              confirmConsequential("Test event sent", { description: "Check Sentry in ~30 seconds." });
            }}
          >
            Send Test Event
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              setTimeout(() => {
                throw new Error(`Sentry uncaught test — ${new Date().toISOString()}`);
              }, 0);
              toast("Throwing uncaught error", { description: "Check Sentry in ~30 seconds." });
            }}
          >
            Throw Uncaught
          </Button>
      </div>
    </AdminCard>
  );
}
