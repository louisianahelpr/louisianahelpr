/**
 * The two photo steps of a delivery, shared by the delivery card and "My route" (and its map):
 * "Picked up" (a photo at the pickup point) and "Left at the door" (a photo at the drop-off).
 * The rules are the server's (helpr_task_picked_up / helpr_task_delivered); this only sends them.
 */
import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { declutterErrorMessage } from "@/lib/declutter/errors";
import { currentPosition } from "@/lib/declutter/position";
import { markDelivered, markPickedUp, uploadTaskPhoto } from "@/lib/helprTasks/api";

export function invalidateTasks(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["helpr-tasks"] });
  void qc.invalidateQueries({ queryKey: ["declutter", "my-cart"] });
}

export function useTaskSteps(taskId: string, userId: string, onDelivered?: () => void) {
  const qc = useQueryClient();
  const done = (msg: string) => { toast(msg); invalidateTasks(qc); };
  // BUY-40: location first (a refusal uploads nothing), then the photo once per file (a retry reuses it).
  const pickedUpPhoto = useRef<{ file: File; path: string } | null>(null);
  const pickedUp = useMutation({
    mutationFn: async (file: File) => {
      const where = await currentPosition();
      if (pickedUpPhoto.current?.file !== file) pickedUpPhoto.current = { file, path: await uploadTaskPhoto(userId, taskId, file) };
      await markPickedUp(taskId, pickedUpPhoto.current.path, where);
    },
    onSuccess: () => done("Picked up. The buyer is told it's on the way."),
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  // The drop-off photo is uploaded once: a retry after a refusal reuses it (lh-silent-failure #10).
  const uploaded = useRef<{ file: File; path: string } | null>(null);
  const delivered = useMutation({
    mutationFn: async (file: File | null) => {
      let path: string | null = null;
      if (file) {
        if (uploaded.current?.file !== file) uploaded.current = { file, path: await uploadTaskPhoto(userId, taskId, file) };
        path = uploaded.current.path;
      }
      const where = path ? await currentPosition() : null;
      return markDelivered(taskId, path, where);
    },
    onSuccess: (r) => {
      onDelivered?.();
      done(r.result === "delivered"
        ? r.held
          ? "Left at the door. A problem was reported on this sale, so your pay waits until Louisiana Helpr decides."
          : "Left at the door. You're paid when the buyer confirms, or after 24 hours."
        : "Delivered. You're being paid.");
    },
    onError: (err) => toast.error(declutterErrorMessage(err)),
  });
  return { pickedUp, delivered, done };
}
