// Shared prop/data shapes for the UserProfile section components. These
// mirror the in-page types exactly — they are lifted verbatim from
// UserProfile.tsx so the extraction is behaviour-preserving.

export type ProfileReview = {
  id: string;
  rating: number;
  punctuality: number | null;
  quality: number | null;
  communication: number | null;
  feedback: string | null;
  created_at: string;
  reviewerName: string;
  jobTitle: string;
  jobCategory: string | null;
  response_text: string | null;
  response_at: string | null;
};

export type ProfileJob = {
  id: string;
  title: string;
  status: string;
  category: string;
  budget: number;
  created_at: string;
  latitude: number | null;
  longitude: number | null;
};

export type ProfileStatsShape = {
  completedJobs: number;
  avgRating: number;
  reviewCount: number;
};

export type ResponseMetrics = {
  avgResponseHours: number | null;
  acceptanceRate: number | null;
  totalApplications: number;
};

export type CancellationRate = {
  total: number;
  cancelled: number;
  rate: number | null;
};

export type LastActiveLabel = { text: string; isLive: boolean };

export type PosterReputation = { reviewCount: number; avgRating: number };

export type PetCareSignal = { distinctPets: number; reportCount: number };
