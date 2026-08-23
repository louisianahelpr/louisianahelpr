/**
 * Mounted once at the app root (App.tsx). Listens to usePermissionRationale
 * state and renders an editorial-styled dialog before any native permission
 * prompt fires. The brand pattern (sienna eyebrow + Bodoni italic title +
 * Garamond italic body) matches PageHeader / hero cards.
 */
import { useEffect, useState } from "react";
import { Bell, Camera, Image as ImageIcon, MapPin, Users, ShieldCheck, type LucideIcon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHero,
} from "@/components/ui/alert-dialog";
import {
  usePermissionRationaleState,
  __resolveRationale,
  type PermissionKind,
} from "@/hooks/usePermissionRationale";

const ICON_FOR_KIND: Record<PermissionKind, LucideIcon> = {
  notifications: Bell,
  camera: Camera,
  photos: ImageIcon,
  location: MapPin,
  contacts: Users,
};

const EYEBROW_FOR_KIND: Record<PermissionKind, string> = {
  notifications: "Stay in the loop",
  camera: "Quick capture",
  photos: "From your library",
  location: "Nearby jobs",
  contacts: "Invite friends",
};

export function PermissionRationaleDialog() {
  const { state, subscribe, copy } = usePermissionRationaleState();
  const [, force] = useState(0);

  useEffect(() => subscribe(() => force((n) => n + 1)), [subscribe]);

  if (!state.open || !copy || !state.kind) return null;

  const Icon = ICON_FOR_KIND[state.kind] ?? ShieldCheck;
  const eyebrow = EYEBROW_FOR_KIND[state.kind] ?? "Heads up";

  return (
    <AlertDialog open={state.open}>
      <AlertDialogContent>
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center"
          style={{
            backgroundColor: "hsl(var(--primary) / 0.10)",
            border: "1px solid hsl(var(--primary) / 0.18)",
            boxShadow:
              "inset 0 1px 1px 0 rgba(255, 255, 255, 0.55), " +
              "0 6px 18px -6px hsl(var(--primary) / 0.30)",
          }}
        >
          <Icon className="w-6 h-6" strokeWidth={1.75} aria-hidden="true" />
        </div>
        <AlertDialogHero
          eyebrow={eyebrow}
          title={copy.title}
        />
        {/* The rationale BODY is the entire point of this dialog and had been
            dropped: `copy.body` existed in usePermissionRationale but nothing
            rendered it, so the sheet read "Location" followed by two buttons
            and gave the user no reason to say yes. (The file's own header
            comment still described a "Garamond italic body" — comment rot.)

            It went missing as fallout from the app-wide "one main title" pass
            that stripped hero subtitles on 2026-07-25. That rule is right for
            a page header and wrong here: this sheet exists ONLY to explain why
            a permission is being asked for, immediately before the OS prompt.
            Without the explanation it is a bare demand, and Apple's own
            guidance is to say why first. Rendered here rather than by
            restoring subtitles globally, so the wider rule stands. */}
        <p
          className="text-ds-14 font-serif italic leading-relaxed -mt-1"
          style={{ color: "hsl(var(--olivewood))" }}
        >
          {copy.body}
        </p>
        <AlertDialogFooter className="flex-col-reverse sm:flex-row gap-2">
          <AlertDialogCancel
            onClick={() => __resolveRationale(false)}
            className="rounded-ds-md h-11 mt-0"
          >
            Not Now
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => __resolveRationale(true)}
            className="rounded-ds-md h-11"
          >
            {copy.cta}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
