import { forwardRef, type ButtonHTMLAttributes } from "react";

/**
 * A photo thumbnail, or a "Photo n" link, that opens the app's own photo viewer (useInAppPhotoViewer). Owner
 * 2026-11-13: a photo never opens its signed URL in Safari, so these were <a target="_blank"> and are buttons now. The
 * look stays the caller's (a bare thumbnail, an underlined name); this only fixes type="button" in one shared place
 * (OWN-SHARED: src/test/noNewHandMadeControls.test.ts). Guard: src/test/photosOpenInApp.test.tsx.
 */
export const PhotoOpenButton = forwardRef<HTMLButtonElement, Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type">>(
  (props, ref) => <button ref={ref} type="button" {...props} />,
);
PhotoOpenButton.displayName = "PhotoOpenButton";
