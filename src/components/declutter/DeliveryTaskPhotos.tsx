import { useQuery } from "@tanstack/react-query";
import { taskPhotoUrl, type TaskView } from "@/lib/helprTasks/api";

// The pickup and drop-off photos on a Helpr delivery, moved out of DeclutterDeliveryViews.tsx unchanged (Q2615).

/** A private task photo through a short-lived signed URL. */
function TaskPhoto({ path, label }: { path: string; label: string }) {
  const url = useQuery({ queryKey: ["helpr-tasks", "photo", path], queryFn: () => taskPhotoUrl(path), staleTime: 5 * 60_000 });
  if (url.isError) {
    return (
      <p className="text-xs" role="alert">
        {label}: the photo couldn't load.{" "}
        <button type="button" className="underline" onClick={() => void url.refetch()}>Try again</button>
      </p>
    );
  }
  if (!url.data) return null;
  return (
    <figure className="space-y-1">
      <img src={url.data} alt={label} className="h-32 w-32 rounded-lg bg-photo-empty object-cover" loading="lazy" />
      <figcaption className="text-xs text-muted-foreground">{label}</figcaption>
    </figure>
  );
}

export function TaskPhotos({ view }: { view: TaskView }) {
  if (!view.pickup_photo_path && !view.dropoff_photo_path) return null;
  return (
    <div className="flex flex-wrap gap-3">
      {view.pickup_photo_path && <TaskPhoto path={view.pickup_photo_path} label="At the pickup" />}
      {view.dropoff_photo_path && <TaskPhoto path={view.dropoff_photo_path} label="At the drop-off" />}
    </div>
  );
}
