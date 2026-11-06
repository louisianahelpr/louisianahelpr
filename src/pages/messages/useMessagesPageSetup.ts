import { useEffect } from "react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { removeShellOncePainted } from "@/components/landing/landingShell";
import { MESSAGES_SHELL_ID } from "@/components/landing/homeShell";

/**
 * The inbox page's two once-per-mount jobs, kept out of Messages.tsx (componentSizeRatchet: at most 600 lines):
 * the tab title, and (Q2705 B) taking away the inbox loading frame index.html drew first (#lh-messages-shell) once
 * the page itself is painted.
 */
export function useMessagesPageSetup(): void {
  usePageTitle("Messages — Helpr");
  useEffect(() => removeShellOncePainted(MESSAGES_SHELL_ID), []);
}
