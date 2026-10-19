import { useCallback, useState } from "react";

/**
 * Home's To do list is COLLAPSED on load (owner, 2026-10-19). Tapping the To
 * do box or the collapsed header opens it; tapping again closes it. The choice
 * lasts for this session only (sessionStorage), never across launches.
 */
const KEY = "helpr_home_todo_open";

function readOpen(): boolean {
  try {
    return window.sessionStorage.getItem(KEY) === "1";
  } catch {
    return false; // storage blocked: collapsed
  }
}

export function useTodoOpen() {
  const [open, setOpen] = useState(readOpen);
  const toggle = useCallback(() => {
    setOpen((o) => {
      const next = !o;
      try {
        window.sessionStorage.setItem(KEY, next ? "1" : "0");
      } catch {
        /* best-effort: the choice just isn't remembered */
      }
      return next;
    });
  }, []);
  return [open, toggle] as const;
}
