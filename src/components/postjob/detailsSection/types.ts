export interface DetailsSectionProps {
  /** 1-based chapter number for the section header. */
  stepNumber: number;
  title: string;
  setTitle: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  category: string;
  setCategory: (v: string) => void;
  imagePreviews: string[];
  imageFiles: File[];
  onImageSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveImage: (index: number) => void;
  /** Per-image upload progress (0-1), keyed by the photo's index. */
  uploadProgressByIndex?: Record<number, number>;
  /** Persist a drag-reordered photo list. Indices map to imageFiles. */
  onReorderImages?: (nextOrder: number[]) => void;
  detailsComplete: boolean;
  /** 0 = open, 1 = ID-verified, 2 = licensed, 3 = licensed + insured.
   *  Only shown for CREDENTIAL_TIER_CATEGORIES; all others stay at 0. */
  credentialTier: number;
  setCredentialTier: (tier: number) => void;
  /** Optional scope video — blob URL or storage URL once uploaded. */
  scopeVideoUrl?: string | null;
  /** Called when the user selects a video file. */
  onVideoSelect?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Clear the selected video. */
  onClearVideo?: () => void;
}
