/** The curtain band's height: the dock clearance pages reserve (safe-area + 96px) plus a 24px overhang. */
const CURTAIN_BAND = "(var(--safe-area-bottom, 0px) + 96px + 24px)";

/**
 * The dock curtain's blur (Q7): ONE unmasked layer (WebKit drops backdrop-filter beside
 * mask-image) whose hard top edge sits 8px below the nav's top edge, just under the
 * pill's top, so the pill and the FAB cover it. Chosen on the iOS 26.5 simulator
 * (2026-10-07): a full-height ramp of stepped bands drew a seam at every step.
 */
const CURTAIN_BLUR_TOP = "8px";
const CURTAIN_BLUR = "blur(16px) saturate(160%)";

/**
 * Frosted curtain behind the dock (rendered inside MobileNav's fixed nav frame), so
 * content scrolling up the page softens as it passes under the dock, not only under
 * the centered pill.
 *
 * The TINT band must be at least as tall as the page-content scroll clearance the
 * fixed-shell pages reserve for the dock (calc(safe-area-inset-bottom + 96px), see
 * PageScaffold / Profile / Messages): shorter, and the last ~28px of reserved space
 * would sit above it, so panels and cards would end in a hard line over bare page
 * background. Its mask fades it to nothing at the top.
 *
 * Q7 (2026-10-07): WebKit drops `backdrop-filter` on an element that also carries
 * `mask-image` (measured on the iOS 26.5 simulator: a striped probe under the dock
 * stayed crisp in this band while the pill, which has no mask, blurred it), and a mask
 * on a PARENT makes a backdrop root and blurs nothing. So blur and mask never share an
 * element (src/test/backdropNeverMasked.test.ts). An unmasked blur has a hard top edge,
 * and a stepped ramp showed every step as a seam, so the BLUR starts CURTAIN_BLUR_TOP
 * below the nav's own top edge, where the pill and the FAB hide that edge, and runs to
 * the screen bottom; above it the masked tint fades as before.
 */
export function DockCurtain() {
  return (
    <>
      <div
        aria-hidden
        className="absolute inset-x-0 pointer-events-none"
        style={{
          top: CURTAIN_BLUR_TOP,
          bottom: "calc(-1 * var(--safe-area-bottom, 0px))",
          backdropFilter: CURTAIN_BLUR,
          WebkitBackdropFilter: CURTAIN_BLUR,
        }}
      />
      <div
        aria-hidden
        className="absolute inset-x-0 pointer-events-none"
        style={{
          // Anchor the band to the bottom of the viewport (the nav is `fixed bottom-0`;
          // its `paddingBottom` is the safe-area inset, so `bottom: -safe-area` puts the
          // curtain's lower edge at the true screen bottom) and give it the full dock
          // clearance (safe-area + 96px) plus a 24px overhang so the fade begins in clear content.
          bottom: "calc(-1 * var(--safe-area-bottom, 0px))",
          height: `calc${CURTAIN_BAND}`,
          // Longer fade (35% solid → transparent) so the tint ramps in gradually.
          maskImage: "linear-gradient(to top, black 35%, transparent 100%)",
          WebkitMaskImage: "linear-gradient(to top, black 35%, transparent 100%)",
          background: "linear-gradient(to top, var(--nav-curtain-top), var(--nav-curtain-fade))",
        }}
      />
    </>
  );
}
