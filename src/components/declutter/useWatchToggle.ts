import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { setWatch } from "@/lib/declutter/api";
import { declutterErrorMessage } from "@/lib/declutter/errors";

/**
 * The Declutter heart (Browse cards, Free cards, the item page): one watchlist write, shown at once.
 *
 * Q2018 (instant feel, optimistic updates on taps): the heart used to wait for declutter_set_watch's
 * round trip before it filled. Now the cached watchlist (["declutter", "watching", userId], a Set of
 * item ids) flips on the tap, goes back to what it was if the write is refused (with the same error
 * toast as before), and is re-read from the server either way. Guard: useWatchToggle.test.tsx.
 */
export function useWatchToggle(userId: string | null | undefined, onWatched?: () => void) {
  const qc = useQueryClient();
  const key = ["declutter", "watching", userId];
  return useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => setWatch(id, on),
    onMutate: async ({ id, on }) => {
      await qc.cancelQueries({ queryKey: key });
      const before = qc.getQueryData<Set<string>>(key);
      if (before) {
        const next = new Set(before);
        if (on) next.add(id);
        else next.delete(id);
        qc.setQueryData(key, next);
      }
      return { before };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.before) qc.setQueryData(key, ctx.before);
      toast.error(declutterErrorMessage(err));
    },
    onSuccess: (_r, { on }) => {
      // SS-5: a new heart says where to find the item again.
      if (on) onWatched?.();
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ["declutter", "watching"] }),
  });
}
