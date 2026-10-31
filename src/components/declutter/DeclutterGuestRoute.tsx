/**
 * BUY-16: a Declutter route members reach through ProtectedRoute exactly as before, and a signed-out visitor reaches as
 * a guest (DeclutterGate then shows the page while Declutter is open to everyone, the login wall otherwise;
 * DeclutterGuest.tsx). Loaded lazily from App.tsx: useAuthReady pulls the Supabase client, which the shell never loads.
 */
import type { ReactNode } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useAuthReady } from "@/hooks/useAuthReady";

export default function DeclutterGuestOrMember({ children }: { children: ReactNode }) {
  const { user, isReady } = useAuthReady();
  if (!isReady || user) return <ProtectedRoute>{children}</ProtectedRoute>;
  return <>{children}</>;
}
