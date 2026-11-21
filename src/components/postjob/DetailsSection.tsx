import { useEffect } from "react";
import { Briefcase, Camera } from "lucide-react";
import { OptionalExtras } from "./OptionalExtras";
import { useLanguage } from "@/lib/i18n/language";
import "@/lib/i18n/enPostJob";
import { SectionCard } from "@/components/postjob/SectionCard";
import { CREDENTIAL_TIER_CATEGORIES } from "./detailsSection/detailsSectionConstants";
import { TitleField } from "./detailsSection/TitleField";
import { DescriptionField } from "./detailsSection/DescriptionField";
import { CredentialTierSelector } from "./detailsSection/CredentialTierSelector";
import { TaxKindQuestion } from "./detailsSection/TaxKindQuestion";
import { asksTaxKind } from "@/lib/salesTax";
import { PhotoProofToggle } from "./detailsSection/PhotoProofToggle";
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
  imagePreviews,
  imageFiles,
  onImageSelect,
  onRemoveImage,
  uploadProgressByIndex,
  onReorderImages,
  detailsComplete,
  credentialTier,
  setCredentialTier,
  taxKind,
  setTaxKind,
  requirePhotoProof,
  setRequirePhotoProof,
  scopeVideoUrl,
  onVideoSelect,
  onClearVideo,
  placeholdersRefused,
  photosAfterSignup,
}: DetailsSectionProps) {
  const { t: tr } = useLanguage();
  // Automatically reset to tier 0 when switching to a non-trade category
  // so the picker never shows a stale tier on a category where it's hidden.
  useEffect(() => {
    if (!CREDENTIAL_TIER_CATEGORIES.has(category) && credentialTier !== 0) {
      setCredentialTier(0);
    }
  }, [category, credentialTier, setCredentialTier]);

  // A trade's fold also holds "Who can apply?" (licensed / insured), so its title says so (G12).
  const tradeTier = CREDENTIAL_TIER_CATEGORIES.has(category);
  return (
    <SectionCard
      stepNumber={stepNumber}
      title="Details"
      icon={Briefcase}
      complete={detailsComplete}
    >
      {/* The category is picked on screen 1 (board 23, JobCategoryGroups);
          this screen is title, details and photos (board 44). */}
      <TitleField
        title={title}
        setTitle={setTitle}
        category={category}
      />

      <DescriptionField
        description={description}
        setDescription={setDescription}
        category={category}
        placeholdersRefused={placeholdersRefused}
      />

      {/* Owner 11-20 (ease batch): photos, who can apply, photo proof and the
          video are optional, folded under one row. */}
      {/* Jobs audit 11-21 (G12): the fold sits right under the description (above the tax row, which was a phone screen
          tall and buried it), and on a trade its title names "who can apply", which it holds. Photos stay inside it
          (owner 11-20, ease batch). */}
      <OptionalExtras
        icon={Camera}
        title={tr(tradeTier ? "postJob.extras.titleTrade" : "postJob.extras.title")}
        summary={imagePreviews.length > 0 ? tr(imagePreviews.length === 1 ? "postJob.extras.onePhoto" : "postJob.extras.photos", { n: imagePreviews.length }) : tr(tradeTier ? "postJob.extras.subTrade" : "postJob.extras.sub")}
        filled={imagePreviews.length > 0 || credentialTier > 0 || !!scopeVideoUrl}
        testId="post-job-extras"
      >
      {/* "Who can apply?" credential-tier selector — only shown for
          trade categories where licensing/insurance makes sense.
          For all others the tier stays at 0 (open) and this block
          is hidden to keep the form clean. */}
      {tradeTier && (
        <>
          <CredentialTierSelector
            credentialTier={credentialTier}
            setCredentialTier={setCredentialTier}
          />
        </>
      )}

      {/* Sits beside the credential tier because both answer the same
          question — what this job requires of the Helpr — and above the
          poster's OWN photo upload, which is a different thing entirely
          (photos of the job as it is now, not proof that it got done). */}
      <PhotoProofToggle
        requirePhotoProof={requirePhotoProof}
        setRequirePhotoProof={setRequirePhotoProof}
      />

      {photosAfterSignup ? (
        <p className="text-ds-13 text-muted-foreground" data-testid="photos-after-signup">{tr("postJob.extras.photosAfterSignup")}</p>
      ) : (
      <PhotoUpload
        imagePreviews={imagePreviews}
        imageFiles={imageFiles}
        onImageSelect={onImageSelect}
        onRemoveImage={onRemoveImage}
        uploadProgressByIndex={uploadProgressByIndex}
        onReorderImages={onReorderImages}
      />
      )}

      {onVideoSelect && (
        <VideoScope
          scopeVideoUrl={scopeVideoUrl}
          onVideoSelect={onVideoSelect}
          onClearVideo={onClearVideo}
        />
      )}
      </OptionalExtras>

      {/* Q2083 (owner Option 1): the poster says whether the job fixes a movable
          item, cleans carpet, rugs, furniture or clothes, or alters clothes, the
          work Louisiana taxes (La. R.S. 47:301.3 items 5 and 7; jobs.tax_kind).
          Owner 2026-11-06: asked ONLY where that can be true (asksTaxKind).
          Stays out of the fold above: it changes what the poster is charged. One row until Change (G12). */}
      {setTaxKind && asksTaxKind(category) && (
        <TaxKindQuestion category={category} taxKind={taxKind ?? null} setTaxKind={setTaxKind} />
      )}
    </SectionCard>
  );
}
