import { X } from "lucide-react";
import { Input } from "@/components/ui/input";

/** The Add Admin dialog's search box, with the clear ✕ every search field has. */
export function AdminUserSearchField({
  value,
  onChange,
  onEnter,
}: {
  value: string;
  onChange: (next: string) => void;
  onEnter: () => void;
}) {
  return (
    <div className="relative flex-1">
      <Input
        type="search"
        aria-label="Search users by name or email"
        placeholder="Search by name or email…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onEnter()}
        className="pr-10"
      />
      {value && (
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
            onChange("");
            e.currentTarget.parentElement?.querySelector("input")?.focus();
          }}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 !min-h-0 !min-w-0 h-7 w-7 ctl-exit inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/60 btn-press transition"
        >
          <X className="w-4 h-4" strokeWidth={2.25} aria-hidden />
        </button>
      )}
    </div>
  );
}
