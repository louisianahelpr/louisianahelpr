import { useMemo, useState, useEffect, useCallback } from "react";
import { scoreApplicant, type ApplicantData } from "@/lib/applicantScoring";
import { type Job, type EnrichedApplication } from "../activityConstants";
import { type ApplicantBidFields } from "./postedJobsHelpers";

export type ApplicantSort = "recommended" | "rated" | "soonest" | "bid_asc" | "bid_desc";

export type ScoredApp = {
  app: EnrichedApplication;
  score: number;
  signals: string[];
  neighborCount: number;
};

interface UseApplicantComparisonArgs {
  applications: EnrichedApplication[];
  jobs: Job[];
  expandedJobId: string | null;
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
  jobs,
  expandedJobId,
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
  // "bid_asc"     = proposed_price asc (cheapest first; accept_bids jobs only)
  // "bid_desc"    = proposed_price desc (highest first; accept_bids jobs only)
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
      const tier = app.profiles?.subscription_tier;
      // subscription_tier ("elite"=3, "pro"=2, "basic"=1, else 0) is
      // the closest proxy for credentialTier available without a migration.
      const credentialTier = tier === "elite" ? 3 : tier === "pro" ? 2 : tier === "basic" ? 1 : 0;
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
    } else if (applicantSort === "bid_asc") {
      // Cheapest bid first; apps without a bid go to the end
      sorted.sort((a, b) => {
        const pa = (a.app as EnrichedApplication & ApplicantBidFields).proposed_price ?? Infinity;
        const pb = (b.app as EnrichedApplication & ApplicantBidFields).proposed_price ?? Infinity;
        return pa - pb;
      });
    } else if (applicantSort === "bid_desc") {
      // Highest bid first; apps without a bid go to the end
      sorted.sort((a, b) => {
        const pa = (a.app as EnrichedApplication & ApplicantBidFields).proposed_price ?? -Infinity;
        const pb = (b.app as EnrichedApplication & ApplicantBidFields).proposed_price ?? -Infinity;
        return pb - pa;
      });
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

  // When switching to a bid-mode job, default the sort to bid_asc so the
  // cheapest applicant surfaces first. Non-bid jobs fall back to "recommended".
  useEffect(() => {
    const expandedJob = jobs.find((j) => j.id === expandedJobId);
    if (expandedJob?.pricing_mode === "accept_bids") {
      setApplicantSort("bid_asc");
    } else {
      setApplicantSort("recommended");
    }
  }, [expandedJobId]);

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
