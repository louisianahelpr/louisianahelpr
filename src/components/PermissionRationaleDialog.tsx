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
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
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
  location: "Nearby tasks",
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
        <AlertDialogHeader className="space-y-0 text-left sm:text-left">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3"
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
          <span
            className="font-serif italic uppercase text-[0.62rem]"
            style={{ color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
          >
            {eyebrow}
          </span>
          <AlertDialogTitle
            className="font-display italic font-bold leading-tight mt-1"
            style={{
              fontSize: "clamp(1.35rem, 2vw + 0.4rem, 1.65rem)",
              color: "hsl(var(--ink-deep))",
              letterSpacing: "-0.025em",
            }}
          >
            {copy.title}
          </AlertDialogTitle>
          <AlertDialogDescription
            className="font-serif italic mt-2 text-[0.92rem] leading-relaxed"
            style={{ color: "hsl(var(--olivewood) / 0.78)" }}
          >
            {copy.body}
          </AlertDialogDescription>
        </AlertDialogHeader>
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
