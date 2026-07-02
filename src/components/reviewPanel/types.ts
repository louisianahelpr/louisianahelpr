// Only render image URLs whose scheme we control. Local previews are
// `blob:` (createObjectURL) and stored review photos are `https:` Supabase
// public URLs — anything else (e.g. a `javascript:`/`data:` value smuggled
// into a stored photo_urls row) is dropped rather than handed to the DOM.
export const safeImageSrc = (url: string): string | undefined => {
  try {
    const scheme = new URL(url, window.location.origin).protocol;
    return scheme === "blob:" || scheme === "https:" || scheme === "http:"
      ? url
      : undefined;
  } catch {
    return undefined;
  }
};

export interface ReviewFormProps {
  open: boolean;
  onClose: () => void;
  jobId: string;
  revieweeId: string;
  revieweeName: string;
}

export type CategoryKey = "rating" | "punctuality" | "quality" | "communication";

export const CATEGORY_ROWS: { key: CategoryKey; label: string; sublabel: string; required: boolean }[] = [
  { key: "rating", label: "Overall", sublabel: "Your overall experience", required: true },
  { key: "punctuality", label: "Punctuality", sublabel: "Showed up on time", required: false },
  { key: "quality", label: "Quality of work", sublabel: "Met expectations", required: false },
  { key: "communication", label: "Communication", sublabel: "Clear and responsive", required: false },
];

// Display reviews for a user
export interface ReviewListProps {
  userId: string;
}

export type Review = {
  id: string;
  rating: number;
  punctuality: number | null;
  quality: number | null;
  communication: number | null;
  feedback: string | null;
  created_at: string;
  reviewer_id: string;
  photo_urls?: string[] | null;
  reviewerName?: string;
};
