/**
 * What a proof thumbnail's link is called (F36, app audit 2026-10-28: the approve sheet's photo links were read
 * out by their signed storage URL). "Before photo", or "Before photo 2" when there are several; the image inside
 * is then decorative (alt=""), so the name is said once.
 */
export function proofPhotoLinkName(type: "before" | "after", index: number, count: number): string {
  const base = type === "before" ? "Before photo" : "After photo";
  return count > 1 ? `${base} ${index + 1}` : base;
}
