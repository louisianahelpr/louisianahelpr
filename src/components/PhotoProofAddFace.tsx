import { ImagePlus } from "lucide-react";

/** The face of PhotoProof's "Add photo" tile: one copy for the native button and the web file label. */
export function PhotoProofAddFace() {
  return (
    <>
      <ImagePlus className="w-5 h-5" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.75} />
      <span className="font-sans font-semibold mt-1 text-ds-10" style={{ color: "hsl(var(--bark))", letterSpacing: "0.04em" }}>
        Add photo
      </span>
    </>
  );
}
