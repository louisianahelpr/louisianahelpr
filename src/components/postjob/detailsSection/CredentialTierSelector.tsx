import { Label } from "@/components/ui/label";
import { Check } from "lucide-react";
import { CREDENTIAL_TIERS } from "./detailsSectionConstants";

interface CredentialTierSelectorProps {
  credentialTier: number;
  setCredentialTier: (tier: number) => void;
}

// "Who can apply?" credential-tier selector — only shown for
// trade categories where licensing/insurance makes sense.
// For all others the tier stays at 0 (open) and this block
// is hidden to keep the form clean.
export function CredentialTierSelector({
  credentialTier,
  setCredentialTier,
}: CredentialTierSelectorProps) {
  return (
    <div className="space-y-2.5">
      <div className="space-y-0.5">
        <Label>Who can apply?</Label>
        <p className="text-ds-11 font-serif italic leading-snug" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
          Require credentials for licensed trade work.
        </p>
      </div>
      {/* One full-width row per tier, not a 2-up grid.
          There are THREE tiers, so a 2-column grid left the third one —
          "Licensed + Insured", the longest label of the set — alone on its
          own row AND truncated to "Licensed + Insur…", which is the one
          option a poster most needs to read in full.
          Stacking also puts them in their real order: Open → Licensed →
          Licensed + Insured is an escalating requirement, and a vertical
          ladder shows that progression where a grid scrambled it. */}
      <div className="flex flex-col gap-2">
        {CREDENTIAL_TIERS.map(({ value, label, sub, Icon }) => {
          const active = credentialTier === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setCredentialTier(value)}
              aria-pressed={active}
              aria-label={label}
              className="flex items-center gap-2.5 p-2.5 rounded-ds-md transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              style={
                active
                  ? {
                      background: "hsl(var(--parchment) / 0.7)",
                      border: "0.5px solid hsl(var(--bark) / 0.35)",
                      boxShadow:
                        "inset 0 1px 1px 0 rgba(255, 255, 255, 0.65), " +
                        "0 0 0 2px hsl(var(--bark) / 0.18), " +
                        "0 6px 16px -4px hsl(var(--bark) / 0.22)",
                    }
                  : {
                      background: "hsl(var(--parchment) / 0.7)",
                      border: "0.5px solid hsl(var(--olivewood) / 0.22)",
                      boxShadow: "var(--elev-inset-gloss)",
                    }
              }
            >
              <span
                className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                style={{
                  background: active
                    ? "hsl(var(--bark) / 0.15)"
                    : "hsl(var(--olivewood) / 0.10)",
                }}
              >
                <Icon
                  className="w-3.5 h-3.5"
                  style={{
                    color: active
                      ? "hsl(var(--bark))"
                      : "hsl(var(--olivewood) / 0.8)",
                  }}
                  strokeWidth={2.25}
                  aria-hidden
                />
              </span>
              <span className="flex flex-col min-w-0">
                {/* No `truncate` on either line any more. At full width these
                    fit with room to spare, and clipping them was only ever a
                    symptom of the cramped grid — under large Dynamic Type a
                    truncated credential label is worse than a wrapped one. */}
                <span
                  className="font-sans font-semibold leading-tight text-ds-12"
                  style={{
                    color: active
                      ? "hsl(var(--ink-deep))"
                      : "hsl(var(--olivewood) / 0.85)",
                  }}
                >
                  {label}
                </span>
                <span
                  className="font-serif italic leading-tight text-ds-11"
                  style={{
                    color: active
                      ? "hsl(var(--olivewood) / 0.8)"
                      : "hsl(var(--olivewood) / 0.8)",
                  }}
                >
                  {sub}
                </span>
              </span>
              {active && (
                <Check
                  className="w-3.5 h-3.5 ml-auto shrink-0"
                  style={{ color: "hsl(var(--bark))" }}
                  strokeWidth={3}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
