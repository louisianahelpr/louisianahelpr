import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHero } from "@/components/ui/dialog";
import { adminNavGroups } from "@/components/admin/adminNavGroups";
import { cn } from "@/lib/utils";

/**
 * Cmd-K jump between admin sections.
 *
 * The console is 23 sections behind a rail that is collapsed on phones and
 * scrolled on laptops, so "go to Disputes" costs an open, a scan of seven
 * groups, and a click. That is fine once and tedious forty times a shift.
 *
 * Deliberately ONLY sections. Searching users and jobs from here is the
 * obvious next step, but each is a live query with its own permissions and
 * empty states, and mixing them in would make the palette a search surface
 * that sometimes has no answer. Sections are a fixed, instant, complete list —
 * it is honest about what it does, and it never shows a spinner.
 *
 * Reads the same `adminNavGroups` the rail and the side panel render, so a
 * section added there appears here with no second list to keep in step.
 */

const ALL_ITEMS = adminNavGroups.flatMap((g) =>
  g.items.map((it) => ({ id: it.id, label: it.label, group: g.title })),
);

export function AdminCommandPalette({ onSelect }: { onSelect: (view: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  // Cmd-K on mac, Ctrl-K elsewhere. Bound on the window rather than a
  // container so it works wherever focus happens to be, including inside the
  // rail. Ignored while typing in a field so it cannot hijack a search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "k" || !(e.metaKey || e.ctrlKey)) return;
      const el = document.activeElement;
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable);
      if (typing && !open) return;
      e.preventDefault();
      setOpen((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ALL_ITEMS;
    // Match the group too, so "queue" finds the three review queues even
    // though none of them has "queue" in its own label.
    return ALL_ITEMS.filter(
      (it) => it.label.toLowerCase().includes(q) || it.group.toLowerCase().includes(q),
    );
  }, [query]);

  // Keep the highlight in range as the list shrinks under typing, otherwise
  // Enter fires on nothing after the result set narrows.
  useEffect(() => {
    setActive((a) => (a >= results.length ? 0 : a));
  }, [results.length]);

  const choose = (view: string) => {
    setOpen(false);
    setQuery("");
    setActive(0);
    onSelect(view);
  };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (results.length ? (a + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (results.length ? (a - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      choose(results[active].id);
    }
  };

  // Follow the highlight when it moves past the visible window.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHero title="Jump to" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKey}
          placeholder="Search sections…"
          aria-label="Search admin sections"
          aria-controls="admin-palette-results"
          className="w-full rounded-ds-sm border border-border bg-background px-3 py-2 text-ds-13 text-foreground outline-none focus:border-primary"
        />
        {results.length === 0 ? (
          <p className="py-6 text-center text-ds-11 text-muted-foreground">
            No section matches “{query}”.
          </p>
        ) : (
          <ul
            id="admin-palette-results"
            ref={listRef}
            role="listbox"
            aria-label="Admin sections"
            className="mt-1 max-h-72 overflow-y-auto"
          >
            {results.map((it, i) => (
              <li key={it.id} data-idx={i}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(it.id)}
                  className={cn(
                    "flex w-full items-baseline justify-between gap-3 rounded-ds-sm px-3 py-2 text-left transition-colors",
                    i === active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span className="text-ds-13 font-medium">{it.label}</span>
                  <span className="shrink-0 text-ds-10 uppercase tracking-widest opacity-70">{it.group}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
