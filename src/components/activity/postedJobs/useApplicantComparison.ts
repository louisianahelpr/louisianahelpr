import { useMemo, useState, useEffect, useCallback } from "react";
import { scoreApplicant, type ApplicantData } from "@/lib/applicantScoring";
import { type EnrichedApplication } from "../activityConstants";

export type ApplicantSort = "recommended" | "rated" | "soonest";

type ScoredApp = {
  app: EnrichedApplication;
  score: number;
  signals: string[];
  neighborCount: number;
};

interface UseApplicantComparisonArgs {
  applications: EnrichedApplication[];
  // Was `expandedJobId`, coupled to the card-accordion's expand state — now
  // multiple cards can be expanded at once (see PostedJobCard), so that
  // value no longer identifies "the job whose applicants panel is open."
  // This panel already receives `selectedJob` for that; keying the
  // sort-reset off its id is the correct dependency regardless of how many
  // cards are expanded underneath.
  selectedJobId: string;
  neighborCountMap: Map<string, number>;
  completedCountsMap: Map<string, number>;
  repeatHireMap: Map<string, number>;
  onTimeMap: Map<string, number>;
  distanceMap: Map<string, number>;
}

/**
 * Owns the applicant comparison panel's client-side derived state: the
 * multi-factor score + sort, the top-pick badge target, and the private
 * poster notes (localStorage only, never sent to the server).
 */
export function useApplicantComparison({
  applications,
  selectedJobId,
  neighborCountMap,
  completedCountsMap,
  repeatHireMap,
  onTimeMap,
  distanceMap,
}: UseApplicantComparisonArgs) {
  // Sort order for the applicants comparison panel.
  // "recommended" = multi-factor score desc (default)
  // "rated"       = avgRating desc, then reviewCount desc
  // "soonest"     = created_at asc (first to apply)
  // The two bid-price sorts went out with the accept_bids pricing mode
  // (zero production usage); "recommended" is the only default now.
  const [applicantSort, setApplicantSort] = useState<ApplicantSort>("recommended");

  // Build scored + sorted applicant list for the comparison panel.
  // Scoring is purely client-side — no extra queries needed.
  // The score map is keyed by helper_id so the "Recommended" badge
  // can identify the top pick in O(1).
  const { sortedApplications, scoreMap } = useMemo(() => {
    if (applications.length === 0) return { sortedApplications: [] as ScoredApp[], scoreMap: new Map<string, number>() };

    const map = new Map<string, number>();
    const scored = applications.map((app) => {
      // Map EnrichedApplication fields onto ApplicantData — pass null
      // for fields the current query doesn't return so the scoring
      // function skips those dimensions gracefully.
      // credentialTier must come from VERIFIED credentials, never from the
      // paid membership tier. The old subscription_tier proxy made
      // scoreApplicant emit "Licensed" for every Pro and "Insured" for every
      // Elite subscriber — a fabricated safety claim on the hiring surface
      // (an Elite helper with license_status='none' rendered "Licensed ·
      // Insured"). get_safe_profiles returns the real credential fields, and
      // they only count when admin-verified, matching CredentialBadge's gate.
      const p = app.profiles;
      const licenseVerified = !!p?.is_licensed && p?.license_status === "verified";
      const insuranceVerified = !!p?.is_insured && p?.insurance_status === "verified";
      const credentialTier =
        licenseVerified && insuranceVerified ? 3
        : licenseVerified ? 2
        : insuranceVerified ? 1 // score credit, but no "Licensed" signal
        : 0;
      const neighborCount = neighborCountMap.get(app.helper_id) ?? 0;
      const data: ApplicantData = {
        userId: app.helper_id,
        avgRating: app.avgRating ?? null,
        reviewCount: app.reviewCount ?? 0,
        completedJobs: completedCountsMap.get(app.helper_id) ?? 0,
        repeatHirePercent: repeatHireMap.get(app.helper_id) ?? null,
        onTimePercent: onTimeMap.get(app.helper_id) ?? null,
        credentialTier,
        distanceKm: distanceMap.get(app.helper_id) ?? null,
        responseTimeMinutes: null,
        neighborCount,           // live from get_neighbor_hire_count RPC
      };
      const result = scoreApplicant(data);
      map.set(app.helper_id, result.score);
      return { app, score: result.score, signals: result.signals, neighborCount };
    });

    const sorted = [...scored];
    if (applicantSort === "recommended") {
      sorted.sort((a, b) => b.score - a.score);
    } else if (applicantSort === "rated") {
      sorted.sort((a, b) => {
        const ratingDiff = (b.app.avgRating ?? 0) - (a.app.avgRating ?? 0);
        if (ratingDiff !== 0) return ratingDiff;
        return (b.app.reviewCount ?? 0) - (a.app.reviewCount ?? 0);
      });
    } else if (applicantSort === "soonest") {
      // "soonest" = first to apply (ascending created_at)
      sorted.sort((a, b) => a.app.created_at.localeCompare(b.app.created_at));
    }

    return { sortedApplications: sorted, scoreMap: map };
  }, [applications, applicantSort, neighborCountMap, completedCountsMap, repeatHireMap, onTimeMap, distanceMap]);

  // Private poster notes — stored in localStorage, never sent to the server.
  // Must be declared after sortedApplications (useMemo above) because the
  // useEffect dependency array evaluates sortedApplications.length at render.
  const [applicantNotes, setApplicantNotes] = useState<Record<string, string>>({});
  const [noteEditing, setNoteEditing] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  useEffect(() => {
    const notes: Record<string, string> = {};
    for (const { app } of sortedApplications) {
      const saved = localStorage.getItem(`helpr_applicant_note_${app.id}`);
      if (saved) notes[app.id] = saved;
    }
    setApplicantNotes(notes);
  }, [sortedApplications.length]);

  const saveNote = useCallback((appId: string) => {
    const trimmed = noteDraft.trim();
    if (trimmed) {
      localStorage.setItem(`helpr_applicant_note_${appId}`, trimmed);
    } else {
      localStorage.removeItem(`helpr_applicant_note_${appId}`);
    }
    setApplicantNotes((prev) => {
      const next = { ...prev };
      if (trimmed) next[appId] = trimmed;
      else delete next[appId];
      return next;
    });
    setNoteEditing(null);
    setNoteDraft("");
  }, [noteDraft]);

  // The top recommended applicant — used to render the badge.
  const topHelperIdByScore = useMemo(() => {
    if (applications.length === 0) return null;
    let topId: string | null = null;
    let topScore = -Infinity;
    scoreMap.forEach((score, id) => {
      if (score > topScore) { topScore = score; topId = id; }
    });
    return topId;
  }, [applications, scoreMap]);

  // Opening a different job's applicants resets the sort to the default.
  // This branched on pricing_mode ("accept_bids" jobs opened on bid_asc)
  // until bidding was removed; every job now takes what was the else-branch,
  // so behaviour for real (set_price) jobs is unchanged.
  useEffect(() => {
    setApplicantSort("recommended");
  }, [selectedJobId]);

  return {
    applicantSort,
    setApplicantSort,
    sortedApplications,
    topHelperIdByScore,
    applicantNotes,
    noteEditing,
    setNoteEditing,
    noteDraft,
    setNoteDraft,
    saveNote,
  };
}
