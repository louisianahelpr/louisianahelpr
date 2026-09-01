import { ShieldCheck, BadgeCheck, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface CredentialState {
  is_licensed?: boolean | null;
  is_insured?: boolean | null;
  license_status?: string | null;
  insurance_status?: string | null;
  /**
   * Optional business name off the licence / COI. Rendered INSIDE the badge so
   * a poster sees WHO is licensed, not just that someone is — and only while a
   * credential is verified (see `trustedName`). The server agrees:
   * `get_safe_profiles()` masks this column unless the same condition holds,
   * so a client that forgot to gate it still cannot leak an unvetted claim.
   */
  business_name?: string | null;
}

/**
 * Tiered "Seal of Trust" badge.
 *
 * - Both verified  → single high-prominence "Licensed & Insured" gold seal.
 * - One verified   → blue/silver "Licensed" or "Insured" badge.
 * - Either pending → same badge at 50% opacity with "Pending" label.
 */
function CredentialBadge({
  credentials,
  size = "sm",
}: {
  credentials: CredentialState | null | undefined;
  size?: "sm" | "md" | "lg";
}) {
  if (!credentials) return null;
  const {
    is_licensed,
    is_insured,
    license_status,
    insurance_status,
    business_name,
  } = credentials;

  const licenseVerified = is_licensed && license_status === "verified";
  const insuranceVerified = is_insured && insurance_status === "verified";
  const licensePending = is_licensed && license_status === "pending";
  const insurancePending = is_insured && insurance_status === "pending";

  // Nothing to show
  if (!licenseVerified && !insuranceVerified && !licensePending && !insurancePending) {
    return null;
  }

  const sizeCls =
    size === "lg"
      ? "text-ds-13 px-3 py-1.5 gap-1.5"
      : size === "md"
      ? "text-ds-11 px-2.5 py-1 gap-1"
      : "text-ds-10 px-2 py-0.5 gap-1";

  const iconSize = size === "lg" ? "w-4 h-4" : size === "md" ? "w-3.5 h-3.5" : "w-3 h-3";

  // The name rides the badge ONLY while something is verified. A pending or
  // rejected credential proves nothing, so attaching a company name to it
  // would dress an unreviewed claim in the badge's credibility.
  const trustedName =
    licenseVerified || insuranceVerified ? (business_name?.trim() || null) : null;
  const nameSuffix = trustedName ? (
    <span className="min-w-0 max-w-[10rem] truncate font-normal opacity-80" title={trustedName}>
      · {trustedName}
    </span>
  ) : null;

  // Tier 1 — Both verified: literal gold seal. Top prestige across the
  // app, so it gets the heaviest gold treatment (matches the tier-gold-elite
  // tier badge for visual consistency).
  if (licenseVerified && insuranceVerified) {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full font-semibold tier-gold-elite max-w-full",
          sizeCls
        )}
        title={
          trustedName
            ? `${trustedName} — licensed & insured, verified by Helpr`
            : "Licensed & Insured — verified by Helpr"
        }
      >
        <ShieldCheck className={cn(iconSize, "verified-gold", "shrink-0")} />
        Licensed &amp; Insured
        {nameSuffix}
      </span>
    );
  }

  // Tier 2 — One verified
  if (licenseVerified) {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full font-semibold border bg-primary/10 text-primary border-primary/30 max-w-full",
          sizeCls
        )}
        title={trustedName ? `${trustedName} — license verified by Helpr` : "License verified by Helpr"}
      >
        <BadgeCheck className={cn(iconSize, "shrink-0")} />
        Licensed
        {nameSuffix}
        {insurancePending && <span className="shrink-0 opacity-70">· Insurance pending</span>}
      </span>
    );
  }
  if (insuranceVerified) {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full font-semibold border bg-primary/10 text-primary border-primary/30 max-w-full",
          sizeCls
        )}
        title={trustedName ? `${trustedName} — insurance verified by Helpr` : "Insurance verified by Helpr"}
      >
        <BadgeCheck className={cn(iconSize, "shrink-0")} />
        Insured
        {nameSuffix}
        {licensePending && <span className="shrink-0 opacity-70">· License pending</span>}
      </span>
    );
  }

  // Tier 3 — Pending only (50% opacity)
  if (licensePending && insurancePending) {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full font-medium border bg-muted/50 text-muted-foreground border-border opacity-60",
          sizeCls
        )}
        title="Credentials under review"
      >
        <Clock className={iconSize} />
        Verification pending
      </span>
    );
  }
  if (licensePending) {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full font-medium border bg-muted/50 text-muted-foreground border-border opacity-60",
          sizeCls
        )}
        title="License under review"
      >
        <Clock className={iconSize} />
        License pending
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-medium border bg-muted/50 text-muted-foreground border-border opacity-60",
        sizeCls
      )}
      title="Insurance under review"
    >
      <Clock className={iconSize} />
      Insurance pending
    </span>
  );
}

export default CredentialBadge;
