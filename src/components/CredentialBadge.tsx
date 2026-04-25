import { ShieldCheck, BadgeCheck, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CredentialState {
  is_licensed?: boolean | null;
  is_insured?: boolean | null;
  license_status?: string | null;
  insurance_status?: string | null;
}

/**
 * Tiered "Seal of Trust" badge.
 *
 * - Both verified  → single high-prominence "Licensed & Insured" gold seal.
 * - One verified   → blue/silver "Licensed" or "Insured" badge.
 * - Either pending → same badge at 50% opacity with "Pending" label.
 */
export function CredentialBadge({
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
      ? "text-sm px-3 py-1.5 gap-1.5"
      : size === "md"
      ? "text-xs px-2.5 py-1 gap-1"
      : "text-[10px] px-2 py-0.5 gap-1";

  const iconSize = size === "lg" ? "w-4 h-4" : size === "md" ? "w-3.5 h-3.5" : "w-3 h-3";

  // Tier 1 — Both verified: gold seal of trust
  if (licenseVerified && insuranceVerified) {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full font-semibold border bg-gradient-to-r from-amber-500/15 to-amber-300/15 text-amber-800 dark:text-amber-200 border-amber-500/40 shadow-sm",
          sizeCls
        )}
        title="Licensed & Insured — verified by Helpr"
      >
        <ShieldCheck className={cn(iconSize, "fill-amber-500/20")} />
        Licensed & Insured
      </span>
    );
  }

  // Tier 2 — One verified
  if (licenseVerified) {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full font-semibold border bg-primary/10 text-primary border-primary/30",
          sizeCls
        )}
        title="License verified by Helpr"
      >
        <BadgeCheck className={iconSize} />
        Licensed
        {insurancePending && <span className="opacity-70">· Insurance pending</span>}
      </span>
    );
  }
  if (insuranceVerified) {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full font-semibold border bg-primary/10 text-primary border-primary/30",
          sizeCls
        )}
        title="Insurance verified by Helpr"
      >
        <BadgeCheck className={iconSize} />
        Insured
        {licensePending && <span className="opacity-70">· License pending</span>}
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
