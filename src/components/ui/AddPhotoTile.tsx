import type { ChangeEventHandler, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The app's "Add photo" tile (Q2709, 11-04; owner 10-31 "Nothing hand-made"): the dashed square at the end of a
 * photo row that adds one more. One look for both ways a photo is picked:
 *   - `onClick`: a real <button> (the native app opens the camera / library sheet itself);
 *   - `onFiles` (+ `accept`, `multiple`): a <label> wrapping a hidden file <input> (the web picker), so the whole
 *     tile opens it. `accept` stays a literal at the call site, where uploadMimeParity reads it.
 * Both show the same focus ring (focus-visible on the button, focus-within on the label, which the old native tile
 * never had). The look is PhotoProof's tile, moved here as classes: 80px, rounded-2xl, a 1.5px dashed bark edge
 * at 30% on the card colour at 40%.
 *
 * Guard: src/test/addPhotoTileShared.test.tsx.
 */
const TILE =
  "w-20 h-20 rounded-2xl flex flex-col items-center justify-center cursor-pointer transition-all active:scale-[0.97] border-[1.5px] border-dashed border-[hsl(var(--bark)/0.30)] bg-[hsl(var(--card)/0.4)]";
const RING = "outline-none ring-[hsl(var(--bark)/0.45)]";

type Props = { children: ReactNode; className?: string } & (
  | { onClick: () => void; onFiles?: never; accept?: never; multiple?: never }
  | { onFiles: ChangeEventHandler<HTMLInputElement>; accept: string; multiple?: boolean; onClick?: never }
);

export function AddPhotoTile({ children, className, onClick, onFiles, ...picker }: Props) {
  if (onFiles) {
    return (
      <label className={cn(TILE, RING, "focus-within:ring-2", className)} data-add-photo-tile="">
        {children}
        <input type="file" className="sr-only" onChange={onFiles} {...picker} />
      </label>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cn(TILE, RING, "focus-visible:ring-2", className)} data-add-photo-tile="">
      {children}
    </button>
  );
}
