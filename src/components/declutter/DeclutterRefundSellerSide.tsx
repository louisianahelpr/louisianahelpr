/**
 * A3-74 (audit 11-01): when a refund goes to Louisiana Helpr, both sides reach it, and both are told when it decides.
 * - SellerSideFields: the seller's optional "Why?" words and up to 3 photos on "I don't agree" and on a part offer
 *   (declutter_answer_refund p_note / p_photo_paths, 20261102041000). They become the seller's side of the problem.
 * - SellerSideShown: the buyer reads what the seller said, with the photos.
 * The time frame on both sides is decidesBy (src/lib/declutter/decideBy.ts).
 */
import { ProblemPhotoPicker } from "./DeclutterProblemPhotos";
import { ProblemPhotos } from "./DeclutterProblemSides";

const input = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm";

export function SellerSideFields({ id, note, onNote, photos, onPhotos, disabled }: {
  id: string;
  note: string;
  onNote: (v: string) => void;
  photos: File[];
  onPhotos: (f: File[]) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-2" data-refund-seller-side="">
      <label htmlFor={`${id}-why`} className="block text-xs font-medium">Why? (optional)</label>
      <textarea id={`${id}-why`} className={input} maxLength={1000} rows={3} value={note} disabled={disabled} onChange={(e) => onNote(e.target.value)} />
      <ProblemPhotoPicker files={photos} onChange={onPhotos} disabled={disabled} />
      <p className="text-ds-12 text-muted-foreground">If it goes to Louisiana Helpr, this is your side.</p>
    </div>
  );
}

export function SellerSideShown({ note, photos, who }: { note?: string | null; photos?: string[] | null; who: string }) {
  if (!note && !photos?.length) return null;
  return (
    <div className="space-y-1" data-refund-seller-said="">
      {note && <p className="text-sm [overflow-wrap:anywhere]">{who.charAt(0).toUpperCase() + who.slice(1)} says: &ldquo;{note}&rdquo;</p>}
      <ProblemPhotos paths={photos ?? []} />
    </div>
  );
}
