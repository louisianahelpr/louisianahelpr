import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useFeature } from "@/hooks/useFeature";
import {
  fetchCategorySuggestions,
  reviewCategorySuggestion,
  suggestionErrorMessage,
  type CategorySuggestionRow,
} from "@/lib/categorySuggestions";
import { AdminCard } from "../AdminViewShell";

/**
 * "Suggest a category" admin queue (owner decision I1, 2026-10-14). Each row
 * shows the words, where it was suggested (Jobs or Declutter), who sent it and
 * how many people asked for the same thing. Approve or decline resolves every
 * pending suggestion with the same words in that area at once
 * (admin_review_category_suggestion, audited). Approved suggestions are the
 * list the next category release adds from. Shown only while the
 * 'suggest_category' switch reaches this admin; it lives beside that switch.
 */
const AREA_LABEL: Record<CategorySuggestionRow["area"], string> = { jobs: "Jobs", declutter: "Declutter" };

function SuggestionItem({ row }: { row: CategorySuggestionRow }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const decide = useMutation({
    mutationFn: (approve: boolean) => reviewCategorySuggestion(row.id, approve, note),
    onSuccess: (n, approve) => {
      toast.success(`${approve ? "Approved" : "Declined"}${n > 1 ? ` (${n} matching suggestions)` : ""}.`);
      void qc.invalidateQueries({ queryKey: ["category-suggestions"] });
    },
    onError: (err) => toast.error(suggestionErrorMessage(err)),
  });
  const asked = Number(row.same_count);
  return (
    <li className="rounded-xl border border-border p-3 space-y-2">
      <p className="font-semibold break-words">{row.suggestion}</p>
      <p className="text-xs text-muted-foreground">
        {AREA_LABEL[row.area] ?? row.area} · from {row.suggester_name?.trim() || "a deleted account"}
        {asked > 1 ? ` · ${asked} people asked for this` : ""}
      </p>
      <label className="block text-xs font-medium" htmlFor={`cs-note-${row.id}`}>Note (optional, admins only)</label>
      <input
        id={`cs-note-${row.id}`}
        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
        maxLength={300}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex gap-2">
        <Button onClick={() => decide.mutate(true)} disabled={decide.isPending}>Approve</Button>
        <Button variant="outline" onClick={() => decide.mutate(false)} disabled={decide.isPending}>Decline</Button>
      </div>
    </li>
  );
}

export function CategorySuggestionsCard() {
  const on = useFeature("suggest_category");
  const pending = useQuery({
    queryKey: ["category-suggestions", "pending"],
    queryFn: () => fetchCategorySuggestions("pending"),
    enabled: on,
  });
  if (!on) return null;
  return (
    <AdminCard title="Category suggestions" subtitle="Categories people asked for. Approved ones are added in the next update.">
      {pending.isError ? (
        <p className="text-sm" role="alert">{suggestionErrorMessage(pending.error)}</p>
      ) : pending.isLoading ? (
        <p className="text-sm text-muted-foreground" role="status">Loading…</p>
      ) : (pending.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing waiting.</p>
      ) : (
        <ul className="space-y-3">
          {(pending.data ?? []).map((row) => <SuggestionItem key={row.id} row={row} />)}
        </ul>
      )}
    </AdminCard>
  );
}
