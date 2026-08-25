/**
 * useImpersonation — admin "view as <user>" read-only mode.
 *
 * State is intentionally localStorage-backed (sessionStorage would
 * vanish on a Capacitor cold-launch, which is a worse UX). The flag is
 * NOT a security boundary: it's a UI hint that the admin is browsing
 * the customer-facing app as a specific user, and mutation paths read
 * `isImpersonating()` to refuse writes client-side.
 *
 * Actual permissioning still happens server-side via RLS — an admin
 * inspecting another user's dashboard still authenticates as
 * themselves. We just hide buttons and short-circuit handlers so they
 * don't accidentally post a job on the impersonated user's behalf.
 */
import { useEffect, useState } from "react";
import { safeStorage } from "@/lib/safeStorage";

const IMPERSONATION_KEY = "helpr.admin_impersonating.v1";

export interface ImpersonationState {
  userId: string;
  userName: string;
  startedAt: string;
}

const readState = (): ImpersonationState | null => {
  try {
    const raw = safeStorage.getItem(IMPERSONATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.userId === "string" && typeof parsed?.userName === "string") {
      return parsed as ImpersonationState;
    }
    return null;
  } catch {
    return null;
  }
};

const writeState = (state: ImpersonationState | null) => {
  try {
    if (state) safeStorage.setItem(IMPERSONATION_KEY, JSON.stringify(state));
    else safeStorage.removeItem(IMPERSONATION_KEY);
    // Broadcast so the banner + any mutation guards update in the same
    // tab without needing a page reload. The "storage" event only fires
    // cross-tab, so we ship a custom one in addition.
    window.dispatchEvent(new CustomEvent("helpr:impersonation-change"));
  } catch {
    /* noop */
  }
};

/** Hook — returns the live impersonation state + setters. */
export const useImpersonation = () => {
  const [state, setState] = useState<ImpersonationState | null>(() => readState());

  useEffect(() => {
    const handler = () => setState(readState());
    window.addEventListener("storage", handler);
    window.addEventListener("helpr:impersonation-change", handler);
    return () => {
      window.removeEventListener("storage", handler);
      window.removeEventListener("helpr:impersonation-change", handler);
    };
  }, []);

  const start = (userId: string, userName: string) => {
    const next: ImpersonationState = { userId, userName, startedAt: new Date().toISOString() };
    writeState(next);
    setState(next);
  };

  const stop = () => {
    writeState(null);
    setState(null);
  };

  return { impersonation: state, isImpersonating: !!state, start, stop };
};

/**
 * Imperative read for non-component callers (e.g. mutation handlers).
 * Returns the current impersonation row from storage without forcing a
 * re-render or requiring the caller to use a hook.
 */
const isImpersonating = (): boolean => readState() !== null;

/**
 * Mutation guard: returns true when writes are allowed. While
 * impersonating it toasts and returns false so handlers can
 * short-circuit with `if (!assertWritable()) return;`.
 */
export const assertWritable = (): boolean => {
  if (!isImpersonating()) return true;
  return false;
};
