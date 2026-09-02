import * as React from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { avatarGradientFor } from "@/lib/avatarGradient";
import {
  avatarInitials,
  isBlankAvatarBitmap,
  isPlaceholderAvatarUrl,
  type AvatarPhotoRejection,
} from "@/lib/avatarImage";
import { transformedImageUrl } from "@/lib/imageUrl";
import { cn } from "@/lib/utils";

/**
 * UserAvatar — house wrapper around shadcn `Avatar`. The fallback path
 * (no `avatar_url`, broken `<img>`, or still-loading network image) renders
 * a brand-warm gradient hashed deterministically from `userId` so the
 * placeholder is recognizable + stable across mounts instead of the
 * default flat `bg-muted`.
 *
 * - `userId` is the hash seed. Passing the same id always yields the same
 *   gradient — useful when the same person shows up in feed cards and the
 *   profile header.
 * - `initials` is derived from `name` when not supplied (first letter of
 *   first and last whitespace-separated words). Initials text uses
 *   `--ink-deep` so it stays legible on every variant.
 * - `size` accepts a number (pixels) or a Tailwind class string. The
 *   internal `Avatar` defaults to `h-10 w-10` — pass `className` to
 *   override sizing or radius (e.g. `rounded-ds-avatar squircle`).
 * - When the underlying photo URL is a Supabase public-storage URL,
 *   we route it through `transformedImageUrl` at the requested pixel
 *   size to avoid loading multi-MB originals into a 44px circle.
 *
 * ── WHY THIS RENDERS ITS OWN `<img>` INSTEAD OF `AvatarImage` ──────────────
 *
 * The owner's "solid red square with no letters" defect (2026-08-31) is a
 * photo that loads FINE and contains nothing — see `src/lib/avatarImage.ts`
 * for the measured prod evidence. Catching it needs three things the Radix
 * `Avatar.Image` primitive cannot give us:
 *
 *   1. an `onLoad` on the element that actually decoded, so the bitmap can be
 *      sampled. Radix renders its `<img>` only AFTER a private probe image
 *      has loaded, and swallows the probe's events;
 *   2. an `onError` we can act on. Radix turns an error into "render the
 *      fallback" internally, with no way to intervene;
 *   3. control over `crossOrigin` retries. Radix copies `crossOrigin` onto
 *      its probe (`image.crossOrigin = crossOrigin ?? null`), so a host with
 *      no `access-control-allow-origin` header fails the probe outright and a
 *      perfectly good photograph silently becomes a monogram — the one way
 *      this fix could do more harm than the bug.
 *
 * Rendering the `<img>` ourselves also drops the duplicate request: Radix
 * fetches once to probe and once to display.
 *
 * The `AvatarFallback` is now ALWAYS mounted and the photo is layered over it
 * (`absolute inset-0`). That is what makes the fallback the ground state: it
 * shows while the photo is in flight, it is already painted underneath if the
 * photo turns out to be blank, and there is no frame in which the avatar is
 * empty. With no `Avatar.Image` in the tree the Radix context stays `idle`,
 * which is exactly the condition `AvatarFallback` renders under.
 */
interface UserAvatarProps
  extends Omit<React.ComponentPropsWithoutRef<typeof Avatar>, "children"> {
  /** Stable hash seed — typically `user_id`. Drives the fallback gradient. */
  userId: string | null | undefined;
  /** Photo URL (Supabase storage URL or any web URL). May be null. */
  src?: string | null;
  /** Display name — used to compute initials if `initials` isn't given. */
  name?: string | null;
  /** Override initials (1-3 chars). Defaults to first letters of `name`. */
  initials?: string;
  /**
   * Optional rendered pixel size — if provided, the image URL is
   * transformed to a thumbnail at this size (CDN-side resize).
   */
  pixelSize?: number;
  /** Alt text on the image. Defaults to "". */
  alt?: string;
  /** Extra classes for the inner fallback (gradient sits inside this). */
  fallbackClassName?: string;
  /**
   * Reports whether a real photograph is on screen, and when it is not, why.
   * `null` means a photo IS showing; any other value means the monogram is
   * the final render.
   *
   * ── WHY THIS EXISTS ───────────────────────────────────────────────────
   * Before this, the bitmap-level verdict was reachable only from INSIDE
   * this component, so a caller could not tell a genuine photograph from a
   * flat block that had been rejected — both left `avatar_url` non-null and
   * neither fired `onError`. Two surfaces got that wrong in the same way:
   * `ProfileHeaderCard` painted the "ID verified" shield over a monogram,
   * and `PhotoNameSection` suppressed the "add a photo" prompt for exactly
   * the member who most needed it. Both call sites documented the gap and
   * named this prop as the fix.
   *
   * ── CONTRACT ──────────────────────────────────────────────────────────
   * Fired on every CHANGE of verdict, including back to `null`, and that
   * totality is load-bearing rather than tidiness: without the `null` edge a
   * caller's `rejected` state would survive a re-upload (the cache-busted
   * `?t=` src that lands after every upload) and survive row recycling in a
   * list, leaving a stale "no photo" verdict painted over a good photo.
   *
   * It is NOT fired while the image is still in flight — the verdict during
   * that window is `null`, i.e. "not rejected yet". A caller must therefore
   * treat `null` as "assume a photo" and not as "confirmed photo", which is
   * the right default: hiding a real trust signal on every load would be a
   * worse regression than a badge that resolves a frame late. For an image
   * already in the memory cache — the list-scroll case — the ref callback
   * samples it before paint, so there is no window at all.
   *
   * Identity is not part of the contract: an inline arrow is fine, the
   * callback is held in a ref so re-creating it does not re-fire.
   */
  onPhotoRejected?: (reason: AvatarPhotoRejection | null) => void;
}

const UserAvatar = React.forwardRef<
  React.ElementRef<typeof Avatar>,
  UserAvatarProps
>(function UserAvatar(
  {
    userId,
    src,
    name,
    initials,
    pixelSize,
    alt = "",
    className,
    fallbackClassName,
    onPhotoRejected,
    ...rest
  },
  ref,
) {
  // A truthy-but-broken `src` (stale storage path, deleted bucket, 404) would
  // otherwise fail to load and paint the alt text over a transparent box.
  // Treat a load error as "no photo" and fall through to the monogram.
  //
  // This holds the REASON rather than a boolean so `onPhotoRejected` can tell
  // a blank upload (the member can fix it) from a load failure (they cannot).
  // `null` is "not rejected" and covers both "still loading" and "it's fine".
  const [failure, setFailure] = React.useState<"blank-bitmap" | "load-error" | null>(null);

  // `crossOrigin="anonymous"` is what makes the blank-bitmap sample possible:
  // without it the canvas is tainted and `getImageData` throws. Measured
  // 2026-08-31 against prod — every host that actually serves member photos
  // (Supabase storage, where all 16 real avatar rows live) answers with an
  // `access-control-allow-origin` header, so the common path costs exactly
  // one request.
  //
  // But `crossOrigin` against a host that sends NO such header does not
  // merely taint the canvas — it fails the LOAD outright, and a real
  // photograph would become a monogram. So an error while in CORS mode is not
  // a verdict: drop the attribute and re-request the same URL once as an
  // ordinary image. Only the SECOND failure is a real one. `key` on the
  // `<img>` is load-bearing — without it React patches the attribute off an
  // element that is already in its error state and nothing re-requests.
  const [corsMode, setCorsMode] = React.useState<"anonymous" | "plain">("anonymous");

  const gradient = avatarGradientFor(userId);
  // Hardened: an explicitly-passed empty/whitespace `initials` must not win
  // over the derived value, or the monogram is a coloured circle with nothing
  // in it — the very defect this component is being fixed for.
  const text = initials?.trim() || avatarInitials(name);
  const imageSrc =
    src && pixelSize
      ? transformedImageUrl(src, { width: pixelSize, height: pixelSize })
      : src ?? undefined;

  // Row recycling: a conversation list re-renders the same <UserAvatar> with a
  // different person's photo. Without this reset, one blank avatar earlier in
  // the list would keep every subsequent occupant of that slot on the
  // monogram path.
  React.useEffect(() => {
    setFailure(null);
    setCorsMode("anonymous");
  }, [imageSrc]);

  const handleError = React.useCallback(() => {
    if (corsMode === "anonymous") {
      // Not a verdict — retry the same URL without the CORS attribute.
      setCorsMode("plain");
      return;
    }
    setFailure("load-error");
  }, [corsMode]);

  // Sampling runs from BOTH the ref callback and `onLoad`. The ref fires first
  // for an image already in the memory cache (`complete` is true the moment
  // the element is attached), which is the list-scroll case, and catches it
  // before a blank frame can paint; `onLoad` covers the cold fetch.
  // `isBlankAvatarBitmap` is a no-op when the bitmap isn't decoded yet.
  const inspect = React.useCallback((img: HTMLImageElement | null) => {
    if (!img) return;
    if (isBlankAvatarBitmap(img)) setFailure("blank-bitmap");
  }, []);

  const handleLoad = React.useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => inspect(e.currentTarget),
    [inspect],
  );

  // A monogram GENERATOR URL is not a photo — see `isPlaceholderAvatarUrl`.
  // Checked against the raw `src`, not the transformed one, since the
  // transform only ever touches Supabase URLs.
  //
  // `rejection` is the single expression BOTH the render and the callback
  // read, so a caller's badge can never disagree with the pixels beside it —
  // the two cannot drift because there is only one decision.
  const rejection: AvatarPhotoRejection | null = !imageSrc
    ? "no-photo"
    : isPlaceholderAvatarUrl(src)
      ? "placeholder-url"
      : failure;
  const showPhoto = rejection === null;

  // Held in a ref so an inline `onPhotoRejected={(r) => …}` — which every
  // call site writes — does not make the effect below re-fire on every
  // render of the parent. The effect depends on the VERDICT only, which is
  // what "fired on every change of verdict" in the prop docs means.
  const onPhotoRejectedRef = React.useRef(onPhotoRejected);
  React.useEffect(() => {
    onPhotoRejectedRef.current = onPhotoRejected;
  });
  React.useEffect(() => {
    onPhotoRejectedRef.current?.(rejection);
  }, [rejection]);

  return (
    <Avatar ref={ref} className={className} {...rest}>
      <AvatarFallback
        // While a photo is showing, the monogram underneath is decoration —
        // it must not be announced on top of the image's own alt text.
        aria-hidden={showPhoto || undefined}
        className={cn(
          // Neutralize the default `bg-muted` (a flat sand fill) from
          // shadcn's `AvatarFallback`. The gradient sits on
          // `background-image`, so we explicitly zero out the
          // background-color to keep the from/to stops accurate rather
          // than letting sand bleed through the partly-transparent `to-`.
          //
          // Ring treatment: a hairline ring using `--olivewood` at low
          // opacity separates the gradient circle from light backgrounds
          // (cards, parchment page) and gives it a finished edge without
          // a hard border. `drop-shadow-sm` adds depth on the lighter
          // variants. `text-[hsl(var(--ink-deep))]` keeps initials legible
          // on every gradient pair; font-display italic matches the brand
          // voice used elsewhere for initials and avatar text.
          "bg-transparent bg-gradient-to-br text-[hsl(var(--ink-deep))] font-display italic font-bold",
          "ring-[1.5px] ring-[hsl(var(--olivewood)/0.12)] ring-offset-0",
          "drop-shadow-[0_1px_3px_hsl(var(--olivewood)/0.12)]",
          gradient,
          fallbackClassName,
        )}
      >
        {text}
      </AvatarFallback>
      {showPhoto ? (
        <img
          key={corsMode}
          ref={inspect}
          src={imageSrc}
          alt={alt}
          loading="lazy"
          decoding="async"
          crossOrigin={corsMode === "anonymous" ? "anonymous" : undefined}
          onError={handleError}
          onLoad={handleLoad}
          // `object-cover` rather than the primitive's bare `aspect-square
          // h-full w-full`: a 2502×1407 avatar (there is one on prod) was
          // being squashed into the circle instead of cropped.
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
    </Avatar>
  );
});

export { UserAvatar };
export default UserAvatar;
