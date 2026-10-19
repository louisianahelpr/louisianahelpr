/**
 * The signed lease as a PDF, for both sides (owner D4). Made from the stored record (template version +
 * filled blanks + both signatures), so the landlord and the tenant always download the same document, any
 * time, for as long as the tenancy's record exists. The last page is the signature record: each typed
 * name, when it was signed (Central time), and the sha256 of the lease text both signatures cover.
 *
 * ASCII (Latin-1) only: jsPDF's built-in faces have no slot for anything else (see pdfDocument.ts).
 */
import { CONTENT_W, INK, MARGIN, MUTED, PAGE_H, VERIFICATION_EMAIL, createLetterheadPdf, finishPdf, type PdfFile } from "@/lib/pdfDocument";
import { normalizeSignature, type LeaseSection } from "./leaseTemplate";

export interface LeasePdfInput {
  sections: LeaseSection[];
  bodySha256: string;
  landlordSignedName: string;
  landlordSignedAt: string;
  tenantSignedName: string | null;
  tenantSignedAt: string | null;
  homeLabel: string;
}

export function leaseSignedAtLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { timeZone: "America/Chicago", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }) + " Central";
}

function leaseFileName(input: LeasePdfInput): string {
  const slug = input.homeLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "home";
  const day = (input.tenantSignedAt ?? input.landlordSignedAt).slice(0, 10);
  return `lease-${slug}-${day}.pdf`;
}

const FOOTER = 60;

export async function buildLeasePdf(raw: LeasePdfInput): Promise<PdfFile> {
  // Names and the home label as plain ASCII, like every blank (lead review #4; the server stores them so already).
  const input: LeasePdfInput = {
    ...raw,
    landlordSignedName: normalizeSignature(raw.landlordSignedName),
    tenantSignedName: raw.tenantSignedName === null ? null : normalizeSignature(raw.tenantSignedName),
    homeLabel: normalizeSignature(raw.homeLabel),
  };
  const signed = !!input.tenantSignedAt;
  const { doc, ink, rule, y: top } = await createLetterheadPdf(
    "Residential Lease",
    signed ? `Signed ${leaseSignedAtLabel(input.tenantSignedAt as string)}` : "Signed by the landlord, waiting for the tenant",
  );
  let y = top + 24;
  const need = (h: number) => {
    if (y + h > PAGE_H - FOOTER) {
      doc.addPage();
      y = 64;
    }
  };

  for (const s of input.sections) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    const head = doc.splitTextToSize(s.heading, CONTENT_W) as string[];
    need(head.length * 13 + 18);
    ink(INK);
    doc.text(head, MARGIN, y, { lineHeightFactor: 1.25 });
    y += head.length * 13 + 4;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    for (const p of s.paragraphs) {
      const lines = doc.splitTextToSize(p, CONTENT_W) as string[];
      for (const line of lines) {
        need(12);
        ink(INK);
        doc.text(line, MARGIN, y);
        y += 12;
      }
      y += 4;
    }
    y += 8;
  }

  // The signature record.
  doc.addPage();
  y = 64;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  ink(INK);
  doc.text("Signatures", MARGIN, y);
  y += 10;
  rule(y);
  y += 26;
  const row = (who: string, name: string | null, at: string | null) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    ink(MUTED);
    doc.text(who.toUpperCase(), MARGIN, y, { charSpace: 0.6 });
    y += 16;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    ink(INK);
    doc.text(name ? `/s/ ${name}` : "Not signed yet", MARGIN, y);
    y += 15;
    doc.setFontSize(9);
    ink(MUTED);
    doc.text(at ? `Signed electronically ${leaseSignedAtLabel(at)}` : "-", MARGIN, y);
    y += 30;
  };
  row("Landlord", input.landlordSignedName, input.landlordSignedAt);
  row("Tenant", input.tenantSignedName, input.tenantSignedAt);
  rule(y - 10);
  doc.setFontSize(8.5);
  ink(MUTED);
  const note =
    "Both parties agreed to sign this lease electronically (La. R.S. 9:2607 and Section 21 of this lease). Each signed in their own " +
    "Louisiana Helpr account by typing their name, and initialed each section marked INITIALED; the app recorded each consent and each initial. " +
    `Both signatures cover the exact lease text above, whose SHA-256 fingerprint is ${input.bodySha256}. ` +
    `For verification inquiries: ${VERIFICATION_EMAIL}`;
  doc.text(doc.splitTextToSize(note, CONTENT_W) as string[], MARGIN, y + 6, { lineHeightFactor: 1.35 });

  return finishPdf(doc, leaseFileName(input));
}
