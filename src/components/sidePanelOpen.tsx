import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { safeStorage } from "@/lib/safeStorage";

const STORAGE_KEY = "helpr.sidePanelOpen";

/**
 * Whether the website's side panel (DesktopSidebarNav) is showing.
 *
 * The site no longer changes shape with the viewport — owner, 2026-08-23: "no
 * matter what size it is, it should never change to look different." So the
 * panel is not hidden by a breakpoint any more; it is opened and closed by the
 * hamburger in the top bar, and that choice is the user's to make at any width.
 *
 * Persisted, because a nav panel that silently reopens on every route change or
 * reload is a nav panel the user has to close repeatedly. `safeStorage` is used
 * rather than raw localStorage so a private-mode or storage-disabled browser
 * degrades to the default instead of throwing.
 *
 * Default OPEN: the panel is the primary navigation on the site, so a first
 * visit should show it rather than hide the way around behind a button nobody
 * has been taught to press yet.
 */
type SidePanelValue = {
  open: boolean;
  toggle: () => void;
  setOpen: (next: boolean) => void;
};

const SidePanelContext = createContext<SidePanelValue>({
  open: true,
  toggle: () => {},
  setOpen: () => {},
});

export const SidePanelProvider = ({ children }: { children: ReactNode }) => {
  const [open, setOpenState] = useState<boolean>(() => {
    const stored = safeStorage.getItem(STORAGE_KEY);
    return stored === null ? true : stored === "1";
  });

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    safeStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  }, []);

  const toggle = useCallback(() => setOpen(!open), [open, setOpen]);

  // Mirror onto <html> so CSS can inset the content by the panel width without
  // every page needing to read this context. Matches how `desktop-rail` and
  // `web-desktop` are already mirrored by useAppShellViewport.
  useEffect(() => {
    const el = document.documentElement;
    el.classList.toggle("side-panel-open", open);
    return () => el.classList.remove("side-panel-open");
  }, [open]);

  const value = useMemo(() => ({ open, toggle, setOpen }), [open, toggle, setOpen]);
  return <SidePanelContext.Provider value={value}>{children}</SidePanelContext.Provider>;
};

export const useSidePanel = () => useContext(SidePanelContext);
