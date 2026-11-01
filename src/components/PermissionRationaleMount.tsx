/**
 * The app-root host for PermissionRationaleDialog (B86, 11-01). It holds no dialog code: it listens to the
 * rationale state and loads the dialog chunk when a rationale opens, or once the page has settled, whichever
 * comes first. The dialog imports the shared Dialog primitives, which sit in guest /browse's chunk, so mounting
 * it directly preloaded that chunk and its closure (~90 KB gz) on every signed-in cold load, in the same window
 * as the dock (lab: /home, Slow 4G). The dialog itself is unchanged.
 *
 * Guard: src/test/permissionRationaleLoadsOnAsk.test.tsx.
 */
import { useEffect, useState } from "react";
import { usePermissionRationaleState } from "@/hooks/usePermissionRationale";
import { createLazyModule } from "@/lib/lazyModule";
import { whenPageSettled } from "@/lib/routePrefetch";

const dialog = createLazyModule(() => import("./PermissionRationaleDialog"), "PermissionRationaleMount.dialog");

export function PermissionRationaleMount() {
  const { state, subscribe } = usePermissionRationaleState();
  const [, force] = useState(0);
  useEffect(() => subscribe(() => force((n) => n + 1)), [subscribe]);
  useEffect(() => whenPageSettled(dialog.start), []);
  useEffect(() => {
    if (state.open) dialog.start();
  }, [state.open]);
  const loaded = dialog.use();
  if (!loaded) return null;
  const { PermissionRationaleDialog } = loaded;
  return <PermissionRationaleDialog />;
}
