/**
 * Records that a user explicitly accepted Terms + Privacy + (optionally) the
 * marketing-comms checkbox. Stored in `legal_acceptances` so we have an
 * audit trail for GDPR / CCPA requests and dispute resolution.
 *
 * Usage from Signup.tsx:
 *
 *   import { recordLegalAcceptance } from "@/components/legal/ConsentTracker";
 *   await recordLegalAcceptance(userId, {
 *     terms_version: "2026-04",
 *     privacy_version: "2026-04",
 *     marketing_opted_in: false,
 *   });
 */
import { supabase } from "@/integrations/supabase/client";

export const TERMS_VERSION = "2026-04";
export const PRIVACY_VERSION = "2026-04";

interface AcceptancePayload {
  terms_version: string;
  privacy_version: string;
  marketing_opted_in: boolean;
}

export async function recordLegalAcceptance(userId: string, payload: AcceptancePayload) {
  try {
    await supabase.from("legal_acceptances" as any).insert({
      user_id: userId,
      terms_version: payload.terms_version,
      privacy_version: payload.privacy_version,
      marketing_opted_in: payload.marketing_opted_in,
      ip_address: null,        // captured server-side via trigger if needed
      user_agent: navigator.userAgent.slice(0, 500),
    });
  } catch {
    // Don't block signup if logging fails.
  }
}
