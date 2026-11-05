/**
 * M14 (audit 1105): the "registered business (LLC or corporation)" choice and
 * its legal-name field on payout setup, shown only before any payout account
 * exists (PayoutSetupForm). The onboard call then asks stripe-connect for a
 * Stripe `company` account named for the business.
 */
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

export function PayoutBusinessFields({ isBusiness, onIsBusiness, businessName, onBusinessName, disabled }: {
  isBusiness: boolean;
  onIsBusiness: (v: boolean) => void;
  businessName: string;
  onBusinessName: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <div data-payout-business className="space-y-2">
      <div className="flex items-start gap-2">
        <Checkbox
          id="payout-is-business"
          checked={isBusiness}
          onCheckedChange={(v) => onIsBusiness(v === true)}
          disabled={disabled}
          className="mt-0.5"
        />
        <label htmlFor="payout-is-business" className="font-sans text-ds-13 leading-snug" style={{ color: "hsl(var(--ink-deep))" }}>
          This is a registered business (LLC or corporation)
        </label>
      </div>
      {isBusiness && (
        <div className="space-y-1">
          <label htmlFor="payout-business-name" className="font-sans text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            Business legal name
          </label>
          <Input
            id="payout-business-name"
            value={businessName}
            onChange={(e) => onBusinessName(e.target.value)}
            maxLength={120}
            autoComplete="organization"
            disabled={disabled}
          />
          <p className="font-sans text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
            Stripe will ask for the business's tax ID (EIN) and for you as its owner.
          </p>
        </div>
      )}
    </div>
  );
}
