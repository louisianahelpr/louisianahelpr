import * as React from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { avatarGradientFor } from "@/lib/avatarGradient";
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
 *   first two whitespace-separated words). Initials text uses
 *   `--ink-deep` so it stays legible on every variant.
 * - `size` accepts a number (pixels) or a Tailwind class string. The
 *   internal `Avatar` defaults to `h-10 w-10` — pass `className` to
 *   override sizing or radius (e.g. `rounded-[26px] squircle`).
 * - When the underlying photo URL is a Supabase public-storage URL,
 *   we route it through `transformedImageUrl` at the requested pixel
 *   size to avoid loading multi-MB originals into a 44px circle.
 */
export interface UserAvatarProps
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
}

function computeInitials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
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
    ...rest
  },
  ref,
) {
  const gradient = avatarGradientFor(userId);
  const text = initials ?? computeInitials(name);
  const imageSrc =
    src && pixelSize
      ? transformedImageUrl(src, { width: pixelSize, height: pixelSize })
      : src ?? undefined;

  return (
    <Avatar ref={ref} className={className} {...rest}>
      {imageSrc ? (
        <AvatarImage src={imageSrc} alt={alt} loading="lazy" decoding="async" />
      ) : null}
      <AvatarFallback
        className={cn(
          // Neutralize the default `bg-muted` (a flat sand fill) from
          // shadcn's `AvatarFallback`. The gradient sits on
          // `background-image`, so we explicitly zero out the
          // background-color to keep the from/to stops accurate rather
          // than letting sand bleed through the partly-transparent `to-`.
          // `text-[hsl(var(--ink-deep))]` keeps initials readable on
          // every variant; `drop-shadow-sm` adds a hair of separation on
          // the lighter gradients.
          "bg-transparent bg-gradient-to-br text-[hsl(var(--ink-deep))] font-display italic font-bold drop-shadow-sm",
          gradient,
          fallbackClassName,
        )}
      >
        {text}
      </AvatarFallback>
    </Avatar>
  );
});

export { UserAvatar };
export default UserAvatar;
