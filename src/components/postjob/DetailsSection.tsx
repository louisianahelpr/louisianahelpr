import { useEffect } from "react";
import { Briefcase } from "lucide-react";
import { SectionCard } from "@/components/postjob/SectionCard";
import { CREDENTIAL_TIER_CATEGORIES } from "./detailsSection/detailsSectionConstants";
import { useAutoCategory } from "./detailsSection/useAutoCategory";
import { useTitleDictation } from "./detailsSection/useTitleDictation";
import { CategoryPicker } from "./detailsSection/CategoryPicker";
import { TitleField } from "./detailsSection/TitleField";
import { DescriptionField } from "./detailsSection/DescriptionField";
import { CredentialTierSelector } from "./detailsSection/CredentialTierSelector";
import { PhotoUpload } from "./detailsSection/PhotoUpload";
import { VideoScope } from "./detailsSection/VideoScope";
import type { DetailsSectionProps } from "./detailsSection/types";

// Re-exported for consumers that read the canonical category list
// (e.g. useJobDerived) — the public API of this module is unchanged.
export { categories } from "./detailsSection/detailsSectionConstants";

export function DetailsSection({
  stepNumber,
  title,
  setTitle,
  description,
  setDescription,
  category,
  setCategory,
  imagePreviews,
  imageFiles,
  onImageSelect,
  onRemoveImage,
  uploadProgressByIndex,
  onReorderImages,
  detailsComplete,
  credentialTier,
  setCredentialTier,
  scopeVideoUrl,
  onVideoSelect,
  onClearVideo,
}: DetailsSectionProps) {
  // Automatically reset to tier 0 when switching to a non-trade category
  // so the picker never shows a stale tier on a category where it's hidden.
  useEffect(() => {
    if (!CREDENTIAL_TIER_CATEGORIES.has(category) && credentialTier !== 0) {
      setCredentialTier(0);
    }
  }, [category, credentialTier, setCredentialTier]);

  const { autoCategoryArmedRef, autoCategoryHint, setAutoCategoryHint } =
    useAutoCategory({ title, category, setCategory });

  const { dictation, startTitleDictation } = useTitleDictation({ title, setTitle });

  return (
    <SectionCard
      stepNumber={stepNumber}
      title="Details"
      icon={Briefcase}
      complete={detailsComplete}
    >
      <CategoryPicker
        category={category}
        setCategory={setCategory}
        autoCategoryArmedRef={autoCategoryArmedRef}
        autoCategoryHint={autoCategoryHint}
        setAutoCategoryHint={setAutoCategoryHint}
      />

      <TitleField
        title={title}
        setTitle={setTitle}
        category={category}
        dictation={dictation}
        startTitleDictation={startTitleDictation}
      />

      <DescriptionField
        description={description}
        setDescription={setDescription}
        category={category}
      />

      {/* "Who can apply?" credential-tier selector — only shown for
          trade categories where licensing/insurance makes sense.
          For all others the tier stays at 0 (open) and this block
          is hidden to keep the form clean. */}
      {CREDENTIAL_TIER_CATEGORIES.has(category) && (
        <CredentialTierSelector
          credentialTier={credentialTier}
          setCredentialTier={setCredentialTier}
        />
      )}

      <PhotoUpload
        imagePreviews={imagePreviews}
        imageFiles={imageFiles}
        onImageSelect={onImageSelect}
        onRemoveImage={onRemoveImage}
        uploadProgressByIndex={uploadProgressByIndex}
        onReorderImages={onReorderImages}
      />

      {onVideoSelect && (
        <VideoScope
          scopeVideoUrl={scopeVideoUrl}
          onVideoSelect={onVideoSelect}
          onClearVideo={onClearVideo}
        />
      )}
    </SectionCard>
  );
}
