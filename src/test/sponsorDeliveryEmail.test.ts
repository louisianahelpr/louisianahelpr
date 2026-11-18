// Area 11 H4 (11-18): the 25 Days sponsor confirmation email told digital gift card and local pickup
// sponsors to ship their prize (to Delcambre, or to the winner's shipping address), and the admin email
// said "Not chosen yet". The form sends those two choices as ship_to 'winner' plus a "Prize delivery:"
// first notes line (ClaimSection.tsx withDelivery). Each of the four choices now gets its own line.
//
// @mutate supabase/functions/_shared/email-templates/sponsorDelivery.ts | if (/digital gift card/i.test(m[1])) return 'digital' | if (false) return 'digital'
// @mutate supabase/functions/_shared/email-templates/sponsorDelivery.ts | if (/pickup\|pick up\|will call/i.test(m[1])) return 'pickup' | if (false) return 'pickup'
// @mutate supabase/functions/_shared/email-templates/sponsor-25days.tsx | <DeliveryRow s={s} adminEmail={adminEmail} /> | <Detail label="Ship your prize to">{SPONSOR_SHIP_ADDRESS}</Detail>
// @mutate supabase/functions/_shared/email-templates/sponsor-25days.tsx | {sponsorDeliveryAdminLabel(s)} | Not chosen yet
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { EMPTY, withDelivery, type PrizeDelivery } from "@/components/sponsor/ClaimSection";
import { sponsorPage } from "@/content/sponsorPage";
import {
  sponsorDeliveryAdminLabel,
  sponsorDeliveryLine,
  sponsorDeliveryOf,
} from "../../supabase/functions/_shared/email-templates/sponsorDelivery";

const CHOICES = sponsorPage.claim.form.delivery.options.map((o) => o.value) as PrizeDelivery[];

describe("sponsor emails name each of the four delivery choices (area 11 H4)", () => {
  it("every form choice round-trips through what the form sends to the email's choice", () => {
    expect(CHOICES.length).toBeGreaterThan(3);
    for (const c of CHOICES) {
      const sent = withDelivery({ ...EMPTY, notes: "Ring the bell" }, c);
      expect(sponsorDeliveryOf({ shipTo: sent.shipTo || null, notes: sent.notes })).toBe(c);
    }
  });
  it("only ship-to-us names the Delcambre address; only ship-to-winner asks for a shipping address", () => {
    const lines = Object.fromEntries(CHOICES.map((c) => [c, sponsorDeliveryLine(c as never, "admin@x.co").line]));
    expect(lines.helpr).toContain("Delcambre");
    for (const c of ["winner", "digital", "pickup"]) expect(lines[c]).not.toContain("Delcambre");
    expect(lines.winner).toContain("shipping address");
    expect(lines.digital).toMatch(/digital gift card/);
    expect(lines.digital).not.toContain("shipping address");
    expect(lines.pickup).toMatch(/picks it up from you/);
    expect(lines.pickup).not.toContain("shipping address");
  });
  it("the admin email gives one distinct label per choice, never 'Not chosen yet'", () => {
    const labels = CHOICES.map((c) => {
      const sent = withDelivery({ ...EMPTY }, c);
      return sponsorDeliveryAdminLabel({ shipTo: sent.shipTo || null, notes: sent.notes });
    });
    expect(new Set(labels).size).toBe(CHOICES.length);
    expect(sponsorDeliveryAdminLabel({ shipTo: null, notes: null })).not.toMatch(/not chosen/i);
    const src = blankComments(fs.readFileSync(path.resolve(__dirname, "../../supabase/functions/_shared/email-templates/sponsor-25days.tsx"), "utf8"));
    expect(src).not.toMatch(/Not chosen yet/);
    expect(src).toContain("{sponsorDeliveryAdminLabel(s)}");
    const conf = src.slice(src.indexOf("export const SponsorConfirmationEmail"), src.indexOf("export const SponsorAdminEmail"));
    expect(conf).toContain("<DeliveryRow s={s} adminEmail={adminEmail} />");
  });
});
