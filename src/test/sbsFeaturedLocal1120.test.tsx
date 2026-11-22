/**
 * Small Business Saturday "Featured local" (owner 2026-11-20: free listings for Louisiana businesses taking part in
 * Small Business Saturday, reviewed before they show; "our small business sponsers still get lsited a the to of the
 * list with a badge"):
 *   - the shared validator: required fields, Louisiana town key, link cleaning (https only, no shorteners, no IPs),
 *     profanity, link spam, motels and inns refused, the participating tick required;
 *   - the categories equal the page's sections;
 *   - sponsors stay first: an approved listing that is already a sponsor (same name or same link) is not shown again;
 *   - the migration: the table is closed to browsers, the public read never returns contact_email or a pending row,
 *     the admin functions check the admin role, the write is service role only;
 *   - the form checks before sending and never sends an invalid request.
 *
 * @mutate supabase/functions/_shared/sbsSubmission.ts | const LODGING_RE = /\b(?:motels?\|inns?\|motor lodge\|motor inn)\b/i; | const LODGING_RE = /\b(?:motels?)\b/i;
 * @mutate src/pages/info/giftGuides/SmallBizLocal.tsx |   return rows.filter((r) => !names.has(businessKey(r.name)) && !links.has(hostPath(r.link))); |   return rows;
 * @mutate supabase/functions/_shared/sbsSubmission.ts |   if (raw.participating !== true) errors.participating = "participating"; |
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SMALL_BIZ_CATEGORIES } from "@/content/giftGuideSmallBiz.mjs";
import {
  SBS_CATEGORIES,
  businessKey,
  cleanLink,
  hasProfanity,
  hasUrlSpam,
  isLodging,
  isPrivateAddress,
  linkStatusOk,
  sniffSbsLogo,
  townKey,
  validateSbsSubmission,
} from "../../supabase/functions/_shared/sbsSubmission";
import { initials, withoutSponsors } from "@/pages/info/giftGuides/SmallBizLocal";
import { SmallBizSubmitForm, isLouisianaTown } from "@/pages/info/giftGuides/SmallBizSubmitForm";
import { blankSqlComments } from "./helpers/blankNonCode";

afterEach(() => cleanup());

const good = {
  businessName: "Bayou Candle Co",
  town: "Lafayette",
  category: "Home & Decor",
  link: "facebook.com/bayoucandleco",
  deal: "20% off all candles Saturday only",
  contactEmail: "Owner@Example.com",
  participating: true,
};

describe("the validator", () => {
  it("accepts a good request and cleans it", () => {
    const v = validateSbsSubmission(good);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.value.link).toBe("https://facebook.com/bayoucandleco");
      expect(v.value.contactEmail).toBe("owner@example.com");
    }
  });
  it("refuses motels and inns (owner rule 11-20)", () => {
    for (const name of ["Bayou Motel", "The Oak Inn", "Cajun Motor Lodge", "Teche Inns"]) {
      const v = validateSbsSubmission({ ...good, businessName: name });
      expect(v.ok, name).toBe(false);
      if (!v.ok) expect(v.errors.businessName).toBe("lodging");
    }
    expect(isLodging("Dinner at Innis Cafe")).toBe(false);
    expect(validateSbsSubmission({ ...good, deal: "Stay at our inn for 10% off" }).ok).toBe(false);
  });
  it("refuses profanity and links typed into text boxes", () => {
    expect(hasProfanity("Sh1t Shack")).toBe(true);
    expect(hasProfanity("Scunthorpe Sweets")).toBe(false);
    expect(hasUrlSpam("visit www.cheap.com")).toBe(true);
    expect(hasUrlSpam("20% off at bit.ly")).toBe(true);
    expect(hasUrlSpam("20% off everything")).toBe(false);
    const v = validateSbsSubmission({ ...good, deal: "Go to https://spam.example" });
    expect(!v.ok && v.errors.deal).toBe("spam");
  });
  it("needs the participating tick, a category, an email and a real link", () => {
    const v = validateSbsSubmission({ ...good, participating: false, category: "Hotels", contactEmail: "nope", link: "javascript:alert(1)" });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors).toMatchObject({ participating: "participating", category: "category", contactEmail: "email", link: "url" });
  });
  it("cleans links: https only, no shorteners, addresses or local names", () => {
    expect(cleanLink("http://bayou.com/x")).toBe("https://bayou.com/x");
    expect(cleanLink("instagram.com/bayou")).toBe("https://instagram.com/bayou");
    for (const bad of ["https://localhost./", "https://metadata.google.internal./", "https://127.0.0.1.nip.io/", "https://10-0-0-1.sslip.io/", "https://bit.ly/abc", "https://127.0.0.1/", "https://localhost/", "https://user:pw@bayou.com", "https://bayou.com:8443/", "mailto:x@y.com", "ftp://bayou.com"]) {
      expect(cleanLink(bad), bad).toBeNull();
    }
  });
  it("knows private, loopback and link-local addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fc00::1", "fd12::3", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "172.32.0.1", "100.128.0.1", "2606:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
  it("keys towns the way the server does (sbs_town_key)", () => {
    expect(townKey("Saint Martinville")).toBe("st martinville");
    expect(townKey("St. Martinville, LA")).toBe("st martinville");
    expect(townKey("Ola")).toBe("ola");
    expect(isLouisianaTown("Breaux Bridge")).toBe(true);
    expect(isLouisianaTown("saint martinville")).toBe(true);
    expect(isLouisianaTown("Lafayette Parish")).toBe(true);
    expect(isLouisianaTown("Houston")).toBe(false);
  });
  it("calls a link dead only on 404/410 (bot walls and login walls pass to the admin)", () => {
    expect(linkStatusOk(404)).toBe(false);
    expect(linkStatusOk(410)).toBe(false);
    for (const st of [200, 400, 403, 429, 503]) expect(linkStatusOk(st), String(st)).toBe(true);
  });
  it("follows redirects by hand and re-checks every hop (no bounce to an internal address)", () => {
    const fn = readFileSync(resolve(__dirname, "../../supabase/functions/sbs-featured/index.ts"), "utf8");
    expect(fn).toMatch(/redirect: 'manual'/);
    expect(fn).not.toMatch(/redirect: 'follow'/);
    expect(fn).toMatch(/next = cleanLink\(new URL\(loc, url\)\.toString\(\)\)/);
    expect(fn).toMatch(/if \(!\(await resolvesPublic\(new URL\(url\)\.hostname\)\)\) return false/);
    expect(fn).toMatch(/length > MAX_BODY_BYTES/);
  });
  it("takes PNG, JPEG and WebP logos by their bytes, never SVG", () => {
    expect(sniffSbsLogo(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))).toBe("image/png");
    expect(sniffSbsLogo(new TextEncoder().encode("RIFF0000WEBPVP8 "))).toBe("image/webp");
    expect(sniffSbsLogo(new TextEncoder().encode("<svg xmlns=..."))).toBeNull();
  });
  it("uses the page's own category sections", () => {
    expect([...SBS_CATEGORIES]).toEqual(SMALL_BIZ_CATEGORIES);
  });
});

describe("sponsors stay first", () => {
  const row = (id: string, name: string, link: string) => ({ id, name, town: "Lafayette", category: "Food & Sweets", link, deal: null, has_logo: false });
  it("hides an approved listing that is already a sponsor (same name or same link)", () => {
    const rows = [row("1", "The Sweet Spot LLC", "https://sweetspot.com"), row("2", "Other Shop", "https://www.facebook.com/kingcakes/"), row("3", "New Place", "https://newplace.com")];
    const sponsors = [{ name: "Sweet Spot", links: [null] }, { name: "King Cakes R Us", links: ["https://facebook.com/kingcakes"] }];
    expect(withoutSponsors(rows, sponsors).map((r) => r.id)).toEqual(["3"]);
    expect(businessKey("The Sweet Spot, LLC")).toBe(businessKey("Sweet Spot"));
  });
  it("draws initials when there is no logo", () => {
    expect(initials("Bayou Candle Co")).toBe("BC");
    expect(initials("The Oak & Iron")).toBe("OI");
  });
  // Owner 2026-11-21 (deals by day): the sponsors are the Small Business Saturday deals day; the free listings moved to
  // their own page, /shop-small, so the sponsors never share a page with (or sit below) them.
  it("keeps the free listings off the sponsors' day page, on /shop-small", () => {
    const day = readFileSync(resolve(__dirname, "../pages/info/giftGuides/GiftGuideSmallBiz.tsx"), "utf8");
    expect(day).not.toContain("SmallBizLocal");
    const page = readFileSync(resolve(__dirname, "../pages/info/ShopSmall.tsx"), "utf8");
    expect(page).toContain("<SmallBizLocal ");
  });
});

describe("the migration", () => {
  const sql = blankSqlComments(readFileSync(resolve(__dirname, "../../supabase/migrations/20261120152039_sbs_featured_local.sql"), "utf8"));
  const fn = (name: string) => {
    const i = sql.indexOf(`FUNCTION public.${name}(`);
    expect(i, name).toBeGreaterThan(0);
    return sql.slice(i, sql.indexOf("$function$;", i));
  };
  it("closes the table to browsers", () => {
    expect(sql).toMatch(/ALTER TABLE public\.sbs_featured_submissions ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.sbs_featured_submissions FROM PUBLIC, anon, authenticated/);
    expect(sql).not.toMatch(/CREATE POLICY[^;]*sbs_featured_submissions/);
  });
  it("public read: approved rows only, never the contact email", () => {
    const body = fn("sbs_public_featured");
    expect(body).toMatch(/s\.status = 'approved'/);
    expect(body).not.toMatch(/contact_email'/);
    expect(body).toMatch(/is_seed_email/);
  });
  it("admin functions check the admin role; the write is service role only", () => {
    for (const f of ["sbs_admin_list", "sbs_admin_review"]) expect(fn(f)).toMatch(/has_role\(\(SELECT auth\.uid\(\)\), 'admin'/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.sbs_service_create\(jsonb\) FROM PUBLIC, anon, authenticated;\s*GRANT EXECUTE ON FUNCTION public\.sbs_service_create\(jsonb\) TO service_role;/);
    expect(fn("sbs_service_create")).toMatch(/louisiana_zip_parishes/);
    expect(fn("sbs_service_create")).toMatch(/motels\?\|inns\?\|motor \(lodge\|inn\)/);
    expect(fn("sbs_service_create")).toMatch(/p_row->>'deal'/);
  });
});

  // Holiday audit 1121 area 5 #17: the unticked box says what to do.
  // @mutate src/content/sbsFeaturedLocal.ts |       return "Tick this box to confirm you're taking part in Small Business Saturday."; |       return "This list is for businesses taking part in Small Business Saturday.";
describe("the form", () => {
  it("checks before sending and never sends an invalid request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<SmallBizSubmitForm onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Send for review" }));
    expect(await screen.findByText("Tick this box to confirm you're taking part in Small Business Saturday.")).toBeTruthy();
    expect(screen.getAllByText("Please fill this in.").length).toBeGreaterThan(2);
    expect(screen.getByText(/Private: only our team sees it/)).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
