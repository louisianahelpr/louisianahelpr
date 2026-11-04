/**
 * Three presentational blocks of the Licensed & Insured tab (src/components/profile/CredentialsTab.tsx), moved here
 * unchanged so the tab's one function stays under the 600-line component ratchet (Q806, 2026-11-04, Builder 1): the
 * "We couldn't verify" re-upload banner, the summary card, and the review-then-send bar. All state stays in the tab.
 */
import { ShieldCheck, RefreshCcw, Send } from "lucide-react";
import CredentialBadge from "@/components/CredentialBadge";
import { Button } from "@/components/ui/button";
import { KIND_NOUN, KIND_NOUN_TITLE, type Kind } from "@/components/profile/credentialsTab/credentialKinds";

export function ReverifyBanner({ kind }: { kind: "both" | Kind }) {
  return (
    <div
      className="rounded-2xl p-4 flex items-start gap-3"
      style={{
        background: "hsl(var(--destructive) / 0.06)",
        border: "0.5px solid hsl(var(--destructive) / 0.32)",
      }}
    >
      <span
        className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
        style={{
          background: "hsl(var(--destructive) / 0.12)",
          color: "hsl(var(--destructive-ink))",
        }}
      >
        <RefreshCcw className="w-4 h-4" />
      </span>
      <div className="flex-1 min-w-0">
        {/* Status eyebrow removed (owner, 2026-08-29: "delete globally"). */}
        <h3
          className="font-sans font-bold leading-tight text-ds-16"
          style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
        >
          We couldn't verify your {kind === "both" ? "license or insurance" : kind}.
        </h3>
        <p
          className="font-sans mt-1 leading-snug text-ds-12"
          style={{ color: "hsl(var(--olivewood) / 0.8)" }}
        >
          Attach a clearer copy and send it — we review within one business day. Until then, your verified badge isn't visible to people hiring.
        </p>
      </div>
    </div>
  );
}

{/* Summary card — the ONE home for overall status. The per-document
    cards below say what's happened to each file; this says what posters
    currently see. It used to repeat the same "pending" fact as an
    eyebrow AND a chip, in two different phrasings. */}
export function CredentialsSummaryCard({
  anyVerified,
  licVerified,
  insVerified,
  businessName,
}: {
  anyVerified: boolean;
  licVerified: boolean;
  insVerified: boolean;
  businessName: string | null | undefined;
}) {
  return (
    <div className="rounded-[20px] liquid-glass p-card space-y-3">
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
          style={{
            background: anyVerified ? "hsl(var(--bark) / 0.12)" : "hsl(var(--muted))",
            color: anyVerified ? "hsl(var(--bark))" : "hsl(var(--muted-foreground))",
          }}
        >
          <ShieldCheck className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          {/* Status eyebrow deleted (owner, 2026-08-29/30: "delete globally",
              confirmed twice). This was the summary card's ONLY
              overall-status indicator ("Licensed & Insured" / "Not yet
              verified" etc) — the card no longer states verification status
              at a glance, only the icon tint above (olive vs muted)
              hints at it. */}
          <h2 className="font-sans font-bold leading-tight text-headline-card" style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}>
            Professional credentials
          </h2>
          <p className="font-sans mt-1 text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            Proof of license and insurance earns verified badges on your profile.
          </p>
        </div>
      </div>
      {anyVerified && (
        <div className="pt-1">
          {/* Only the LIVE badge. Feeding the raw row in would make the badge
              append "· Insurance pending", restating a state the card below
              already owns. */}
          <CredentialBadge
            credentials={{
              is_licensed: licVerified,
              license_status: licVerified ? "verified" : "none",
              is_insured: insVerified,
              insurance_status: insVerified ? "verified" : "none",
              business_name: businessName,
            }}
            size="md"
          />
        </div>
      )}
    </div>
  );
}

{/* Review-then-send. Attaching a file used to write `<kind>_url`
    immediately, which trips the DB trigger and drops the helper into the
    admin queue on the spot — so someone with both documents couldn't send
    them as one package, and had no chance to check what they'd picked.
    Nothing leaves the device until this button. */}
export function SendForReviewBar({ draftKinds, submitting, onSend }: { draftKinds: Kind[]; submitting: boolean; onSend: () => void }) {
  return (
    <div
      className="rounded-2xl p-5 space-y-3"
      style={{
        background: "hsl(var(--bark) / 0.06)",
        border: "0.5px solid hsl(var(--bark) / 0.32)",
      }}
    >
      <div className="flex items-start gap-3">
        <span
          className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
          style={{
            background: "hsl(var(--bark) / 0.12)",
            color: "hsl(var(--bark))",
          }}
        >
          <Send className="w-4 h-4" />
        </span>
        <div className="flex-1 min-w-0">
          {/* Small-caps "Ready to send" eyebrow removed at the owner's
              direction (2026-08-27) — the h3 below already says the
              documents are attached, so nothing is lost. */}
          <h3
            className="font-sans font-bold leading-tight text-ds-16"
            style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
          >
            {draftKinds.length > 1
              ? "Your license and insurance are attached."
              : `Your ${KIND_NOUN[draftKinds[0]]} is attached.`}
          </h3>
          <p
            className="font-sans mt-1 leading-snug text-ds-12"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          >
            Check {draftKinds.length > 1 ? "both" : "it"} above, then send when you're ready. Nothing goes to our reviewers until you do.
          </p>
        </div>
      </div>
      <Button
        variant="primary"
        size="sm"
        className="w-full rounded-full"
        disabled={submitting}
        onClick={onSend}
      >
        {submitting
          ? "Sending…"
          : draftKinds.length > 1
            ? "Send both for review"
            : `Send ${KIND_NOUN_TITLE[draftKinds[0]].toLowerCase()} for review`}
      </Button>
    </div>
  );
}
