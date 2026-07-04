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
      <AlertDialogContent className="rounded-ds-pill gap-4 max-w-md">
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
          subtitle={copy.body}
        />
        <AlertDialogFooter className="flex-col-reverse sm:flex-row gap-2">
          <AlertDialogCancel
            onClick={() => __resolveRationale(false)}
            className="rounded-ds-md h-11 mt-0"
          >
            Not now
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
