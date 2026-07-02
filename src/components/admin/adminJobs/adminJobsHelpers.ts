import { safeStorage } from "@/lib/safeStorage";
import type { Job } from "./types";

const RESOLVED_FLAGS_KEY = "admin_resolved_job_flags";

export const getResolvedFlags = (): Set<string> => {
  try { return new Set(JSON.parse(safeStorage.getItem(RESOLVED_FLAGS_KEY) || "[]")); }
  catch { return new Set(); }
};

export const saveResolvedFlags = (set: Set<string>) => {
  safeStorage.setItem(RESOLVED_FLAGS_KEY, JSON.stringify([...set]));
};

// ─── Auto-flag logic ──────────────────────────────────────
export function detectFlags(job: Job): string[] {
  const flags: string[] = [];
  const desc = (job.description || "").toLowerCase();
  const title = (job.title || "").toLowerCase();
  const combined = `${title} ${desc}`;

  // Unreasonably high budget for the category
  if (job.budget > 5000) flags.push("Very high budget ($" + job.budget + ")");

  // Suspiciously low budget with long hours
  if (job.budget <= 10 && (job.estimated_hours || 0) >= 4) flags.push("Very low pay for estimated hours");

  // Spam / scam keywords
  const spamWords = ["cashapp", "venmo", "zelle", "wire transfer", "western union", "crypto", "bitcoin", "pay outside", "off platform", "cash only", "gift card", "send money", "wire me", "advance payment"];
  for (const word of spamWords) {
    if (combined.includes(word)) {
      flags.push("Contains suspicious payment keyword: \"" + word + "\"");
      break;
    }
  }

  // Personal info patterns
  const phoneRegex = /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/;
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  if (phoneRegex.test(combined)) flags.push("Contains phone number in description");
  if (emailRegex.test(combined)) flags.push("Contains email in description");

  // Very short/empty description
  if (desc.trim().length < 10) flags.push("Description too short or vague");

  // Excessive caps (yelling)
  const upperCount = (job.description || "").replace(/[^A-Z]/g, "").length;
  const totalAlpha = (job.description || "").replace(/[^a-zA-Z]/g, "").length;
  if (totalAlpha > 20 && upperCount / totalAlpha > 0.7) flags.push("Excessive caps (possible spam)");

  // Date in the past
  if (job.date_needed && new Date(job.date_needed) < new Date(new Date().toDateString())) {
    flags.push("Date needed is in the past");
  }

  return flags;
}
