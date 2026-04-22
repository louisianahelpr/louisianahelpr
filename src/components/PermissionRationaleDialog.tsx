/**
 * Mounted once at the app root (App.tsx). Listens to usePermissionRationale
 * state and renders an accessible dialog before any native permission prompt.
 */
import { useEffect, useState } from "react";
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
import { usePermissionRationaleState, __resolveRationale } from "@/hooks/usePermissionRationale";

export function PermissionRationaleDialog() {
  const { state, subscribe, copy } = usePermissionRationaleState();
  const [, force] = useState(0);

  useEffect(() => subscribe(() => force((n) => n + 1)), [subscribe]);

  if (!state.open || !copy) return null;

  return (
    <AlertDialog open={state.open}>
      <AlertDialogContent className="rounded-2xl">
        <AlertDialogHeader>
          <div className="text-4xl mb-2" aria-hidden>{copy.icon}</div>
          <AlertDialogTitle className="text-xl">{copy.title}</AlertDialogTitle>
          <AlertDialogDescription className="text-base leading-relaxed pt-1">
            {copy.body}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col-reverse sm:flex-row gap-2">
          <AlertDialogCancel onClick={() => __resolveRationale(false)}>
            Not now
          </AlertDialogCancel>
          <AlertDialogAction onClick={() => __resolveRationale(true)}>
            {copy.cta}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
