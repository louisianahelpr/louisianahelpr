import { useEffect, useState } from "react";
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
        <DialogHero title="Jump to" />
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
          <CommandInput placeholder="Search sections…" aria-label="Search admin sections" />
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
