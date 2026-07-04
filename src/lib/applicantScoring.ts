export interface ApplicantScore {
  userId: string;
  score: number;
  signals: string[]; // human-readable trust signals for the card
}

export interface ApplicantData {
  userId: string;
  avgRating: number | null;
  reviewCount: number;
  completedJobs: number;
  repeatHirePercent: number | null; // 0-100
  onTimePercent: number | null;     // 0-100
  credentialTier: number;           // 0-3 from helper_credentials
  distanceKm: number | null;
  responseTimeMinutes: number | null;
  neighborCount: number;            // how many nearby addresses hired them (trust graph)
}

export function scoreApplicant(a: ApplicantData): ApplicantScore {
  let score = 0;
  const signals: string[] = [];

  // Rating (0–5 → 0–35 pts)
  if (a.avgRating && a.reviewCount >= 3) {
    score += (a.avgRating / 5) * 35;
    if (a.avgRating >= 4.8) signals.push(`${a.avgRating.toFixed(1)}★`);
  }

  // Completed jobs (logarithmic, up to 20 pts)
  if (a.completedJobs > 0) {
    score += Math.min(20, Math.log10(a.completedJobs + 1) * 15);
    if (a.completedJobs >= 10) signals.push(`${a.completedJobs} jobs`);
  }

  // Repeat hire % (up to 15 pts)
  if (a.repeatHirePercent != null) {
    score += (a.repeatHirePercent / 100) * 15;
    if (a.repeatHirePercent >= 50) signals.push(`${a.repeatHirePercent}% repeat hire`);
  }

  // On-time % (up to 10 pts)
  if (a.onTimePercent != null) {
    score += (a.onTimePercent / 100) * 10;
    if (a.onTimePercent >= 90) signals.push("On time");
  }

  // Credential tier (0–10 pts)
  score += a.credentialTier * 2.5;
  if (a.credentialTier >= 2) signals.push("Licensed");
  if (a.credentialTier >= 3) signals.push("Insured");

  // Distance (closer = better, up to 5 pts)
  if (a.distanceKm != null) {
    score += Math.max(0, 5 - a.distanceKm * 0.5);
  }

  // Neighbor trust (up to 5 pts)
  if (a.neighborCount > 0) {
    score += Math.min(5, a.neighborCount * 1.5);
    signals.push(`${a.neighborCount} neighbor${a.neighborCount > 1 ? "s" : ""} hired them`);
  }

  return { userId: a.userId, score, signals };
}
