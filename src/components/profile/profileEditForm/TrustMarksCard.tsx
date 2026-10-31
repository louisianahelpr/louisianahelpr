import { useIdentityCheckOnStore } from "@/lib/identityCheckSwitch";
import { useNavigate } from "react-router-dom";
import { Check } from "lucide-react";
import { identityView } from "@/lib/identityCheck";
import type { Profile } from "./types";
import { usePayoutSetupPaused } from "@/hooks/usePayoutSetupPaused";
import { PayoutSetupPausedNotice } from "@/components/payouts/PayoutSetupPausedNotice";

/**
 * Board 41, TRUST MARKS: the three things that make neighbors trust a profile,
 * each with its state and the one step that finishes it.
 *   - Phone: "Added" once a phone is saved (there is no phone verification,
 *     so the board's "Done" would claim a check nobody ran); else "Add",
 *     which focuses the phone field above.
 *   - Photo ID: from profiles.idv_status (identityView): "Done" when verified,
 *     "Checking" while Stripe or our team is on it, else "Verify now", which
 *     opens the ID check sheet.
 *   - Payout bank: from profiles.stripe_payouts_enabled: "Done", else "Set up",
 *     which opens Money, where payouts are set up.
 */
export function TrustMarksCard({ profile, phone }: { profile: Profile | null; phone: string }) {
  const navigate = useNavigate();
  const view = identityView(profile?.idv_status);
  // Owner ruling 2026-10-23: payout setup is paused; an unfinished payout bank
  // reads "Later" (nothing to tap; no "paused" notice, owner 2026-10-25).
  const setupPaused = usePayoutSetupPaused();
  // Not while the profile is still loading (null is not "not set up").
  const bankPaused = setupPaused && !!profile && !profile.stripe_payouts_enabled;
  // ID check off (switch `identity_check`, owner 2026-10-23): a verified ID still
  // reads Done (true); otherwise the Photo ID row is not shown at all.
  const idOn = useIdentityCheckOnStore();
  const allRows: { key: string; label: string; done: boolean; state: string; onClick?: () => void }[] = [
    phone.trim()
      ? { key: "phone", label: "Phone", done: true, state: "Added" }
      : { key: "phone", label: "Phone", done: false, state: "Add", onClick: () => document.getElementById("phone")?.focus() },
    view === "verified"
      ? { key: "id", label: "Photo ID", done: true, state: "Done" }
      : { key: "id", label: "Photo ID", done: false, state: "Checking" },
    profile?.stripe_payouts_enabled
      ? { key: "bank", label: "Payout bank", done: true, state: "Done" }
      : bankPaused
        ? { key: "bank", label: "Payout bank", done: false, state: "Later" }
        : { key: "bank", label: "Payout bank", done: false, state: "Set up", onClick: () => navigate("/profile?tab=earnings") },
  ];
  // Never an ask (owner 2026-10-30: asked once, when hired or at the first payout):
  // the row shows a verified ID, or a check under way while the check is on.
  const idUnderWay = idOn && (view === "checking" || view === "with_team");
  const rows = allRows.filter((r) => r.key !== "id" || r.done || idUnderWay);
  return (
    <div data-trust-marks="" className="rounded-2xl liquid-glass p-card">
      <p className="font-sans uppercase tracking-wider text-ds-11 font-semibold mb-1" style={{ color: "hsl(var(--olivewood) / 0.75)", letterSpacing: "0.14em" }}>
        Trust marks
      </p>
      <ul className="divide-y" style={{ borderColor: "hsl(var(--border))" }}>
        {rows.map((r) => (
          <li key={r.key} className="flex items-center justify-between gap-3 min-h-11 py-1">
            <span className="text-ds-14 font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>{r.label}</span>
            {r.onClick ? (
              <button type="button" onClick={r.onClick} className="min-h-11 px-1 text-ds-13 font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>
                {r.state}
              </button>
            ) : (
              <span className="inline-flex items-center gap-1 text-ds-13 font-semibold" style={{ color: r.done ? "hsl(var(--ink-deep))" : "hsl(var(--olivewood) / 0.8)" }}>
                {r.done && <Check className="w-3.5 h-3.5" strokeWidth={2.5} aria-hidden />}
                {r.state}
              </span>
            )}
          </li>
        ))}
      </ul>
      {bankPaused && <PayoutSetupPausedNotice compact className="mt-2" />}
    </div>
  );
}
