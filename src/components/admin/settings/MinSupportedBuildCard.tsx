import type { Dispatch, SetStateAction } from "react";
import { Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdminCard } from "../AdminViewShell";

/** Admin -> Settings: the Minimum Supported Build card (moved verbatim out of AdminSettings.tsx, Q806).
 *  The value and saveMinBuild (validation, write, audit log) stay in AdminSettings; this is only the markup. */
export function MinSupportedBuildCard({
  minBuild,
  setMinBuild,
  saveMinBuild,
  savingMinBuild,
}: {
  minBuild: string;
  setMinBuild: Dispatch<SetStateAction<string>>;
  saveMinBuild: () => void;
  savingMinBuild: boolean;
}) {
  return (
    <AdminCard
      title={<span className="flex items-center gap-2"><Smartphone className="w-4 h-4 text-primary" /> Minimum Supported Build</span>}
      subtitle={
        <>
          {/* ENFORCED as of 2026-09-01. This copy said "nothing enforces it
              yet" for as long as that was true, which was the right call —
              an operator would otherwise have set it during an incident and
              believed old builds were being turned away. It is no longer
              true, and a stale reassurance is worse than the original lie:
              it would now talk an operator OUT of using the one lever that
              works while a bad build sits in App Review.

              What reads it: src/hooks/useVersionCheck.ts, via
              get_public_platform_settings() (migration 20260901035235 — the
              table itself is admin-only under RLS, so the column had to
              travel through the RPC to reach a normal user's app).
              src/components/ForceUpdateGate.tsx renders the block.

              The three qualifications below are not hedging, they are the
              actual behaviour, and an operator who does not know them will
              misread what this control did:
                · NATIVE ONLY. The web app has no build number and updates on
                  reload, so it is never blocked — including /admin, which is
                  where this number gets lowered again.
                · FAILS OPEN. A failed settings read, an unparseable build, a
                  missing column: all let the user in. A gate that blocks on
                  its own failure is an outage that needs App Review to fix.
                · Takes about a minute to reach a running app (60s cache),
                  and lands on a backgrounded install when it next comes to
                  the foreground — not only on a cold start. */}
          Blocks native installs older than this build with an{" "}
          <strong className="text-foreground">“Update Helpr to continue”</strong> screen —
          the one lever that works while a bad build is stuck in App Review. Takes
          effect within a minute on running apps.{" "}
          <code className="text-foreground">0</code> is the off value.
          <br />
          <span className="text-ds-11">
            iOS/Android only — the website has no build number and is never blocked.
            The gate fails open, so a settings-read failure never locks anyone out.
            Use the build number from App Store Connect (CFBundleVersion), and set it{" "}
            <em>above</em> the build you are turning away, not equal to it.
          </span>
          <br />
          {/* Not a hypothetical caveat. Probed 2026-09-01: the store URL the
              block screen links to (lib/appStore.ts) returns 404 and the
              iTunes lookup API reports resultCount 0 for its id in four
              storefronts — the listing is not public. Arming the gate today
              would send every blocked user to a dead page, which is why the
              screen also carries the support address. Stated here, next to
              the control, because this is the moment an operator can still
              decide not to. */}
          <span className="text-ds-11 text-[hsl(var(--destructive-ink))]">
            Before setting this above 0, confirm the App Store listing actually
            loads — as of 2026-09-01 the link the block screen sends people to
            returns a 404, which would make the block a dead end. The screen also
            shows the support address, but the store link is the way out.
          </span>
        </>
      }
    >
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="minBuild">Build code</Label>
          <Input
            id="minBuild"
            type="number"
            min={0}
            max={999_999}
            step={1}
            value={minBuild}
            onChange={(e) => setMinBuild(e.target.value)}
            className="max-w-[160px] font-mono tabular-nums"
          />
        </div>
        <Button onClick={saveMinBuild} disabled={savingMinBuild}>
          {savingMinBuild ? "Saving…" : "Save"}
        </Button>
      </div>
    </AdminCard>
  );
}
