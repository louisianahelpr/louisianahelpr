import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Dialog, DialogContent, DialogHero } from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { adminNavGroups } from "@/components/admin/adminNavGroups";

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
 *
 * Built on `cmdk` (via the shadcn Command wrapper) rather than hand-rolled.
 * This used to own its own filtering, active-index state, ArrowUp/ArrowDown
 * handling and scroll-into-view — ~90 lines re-implementing a solved problem,
 * with a `role="listbox"` of `<button role="option">` that never announced an
 * active descendant. cmdk supplies the combobox semantics, typeahead scoring
 * and keyboard model, so this file is now just the data and the shell.
 */

const ALL_ITEMS = adminNavGroups.map((g) => ({
  title: g.title,
  items: g.items.map((it) => ({ id: it.id, label: it.label })),
}));

export function AdminCommandPalette({ onSelect }: { onSelect: (view: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Controlled now (Q913's clear ✕), so a closed palette forgets its query
  // the way the unmounted uncontrolled input used to.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  // Cmd-K / Ctrl-K toggles. Kept here rather than in cmdk because the palette
  // has no trigger element — it is summoned from anywhere in the console.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const choose = (view: string) => {
    setOpen(false);
    onSelect(view);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* No width override: dialogShell.test.ts holds every popup to the
          shared measure unless it has a STRUCTURAL reason, and a palette has
          none — it is a short list of short labels, which the default handles
          fine. Narrowing it would have been a drive-by class against a rule
          the project keeps on purpose. */}
      <DialogContent>
        <DialogHero title="Jump To" />
        <Command
          // The shell already paints the surface; cmdk should not add a second
          // background or its own rounding inside DialogContent.
          className="bg-transparent [&_[cmdk-input-wrapper]]:border-border"
          // Match on the label AND the group title, so typing "money" finds
          // the sections filed under it.
          filter={(value, search) =>
            value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
          }
        >
          <div className="relative">
            <CommandInput
              placeholder="Search sections…"
              aria-label="Search admin sections"
              value={query}
              onValueChange={setQuery}
              className="pr-9"
            />
            {query && (
              // Q913 (owner 2026-10-07): a clear ✕ like every other search field
              // (index.css hides WebKit's own). Pressed off-centre by
              // e2e/prod-audit/search-x-off-center-press.spec.ts.
              <button
                type="button"
                aria-label="Clear search"
                // Keep focus on press so iOS does not drop the keyboard and lose the
                // click (the BrowseSearchBar ✕'s one-press fix, owner 2026-10-01).
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  setQuery("");
                  e.currentTarget.parentElement?.querySelector("input")?.focus();
                }}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 !min-h-0 !min-w-0 h-7 w-7 ctl-exit inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/60 btn-press transition"
              >
                <X className="w-4 h-4" strokeWidth={2.25} aria-hidden />
              </button>
            )}
          </div>
          <CommandList className="max-h-72">
            <CommandEmpty>No section matches.</CommandEmpty>
            {ALL_ITEMS.map((g) => (
              <CommandGroup key={g.title} heading={g.title}>
                {g.items.map((it) => (
                  <CommandItem
                    key={it.id}
                    // `value` is what cmdk scores against — include the group
                    // title so a search for the group surfaces its sections.
                    value={`${it.label} ${g.title}`}
                    onSelect={() => choose(it.id)}
                    className="text-ds-13"
                  >
                    {it.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
