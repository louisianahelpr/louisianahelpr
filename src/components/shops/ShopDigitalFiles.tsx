/**
 * The files a buyer downloads, on the seller's item editor (Shops digital downloads, owner 11-08; migration
 * 20261108182917, edge function shop-digital). 1 to 5 files, PDF, ZIP, PNG or JPG, up to 100 MB each. Each upload is
 * checked from its own bytes before it counts; buyers only ever get a 10-minute link after they pay.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HiddenFileInput } from "@/components/ui/HiddenFileInput";
import { ReportErrorScreen } from "@/components/ui/ReportErrorScreen";
import { shopsErrorMessage } from "@/lib/shops/errors";
import {
  DIGITAL_FILE_ACCEPT,
  DIGITAL_MAX_FILES,
  confirmDigitalFile,
  digitalDownloadUrl,
  fetchMyDigitalFiles,
  fileSizeLabel,
  removeDigitalFile,
  uploadDigitalFile,
} from "@/lib/shops/digitalFiles";

export default function ShopDigitalFiles({ itemId }: { itemId: string }) {
  const qc = useQueryClient();
  const key = ["shops", "digital-files", itemId];
  const files = useQuery({ queryKey: key, queryFn: () => fetchMyDigitalFiles(itemId) });
  const refresh = () => void qc.invalidateQueries({ queryKey: key });

  const add = useMutation({
    mutationFn: (f: File) => uploadDigitalFile(itemId, f),
    onSuccess: () => toast("File added."),
    onError: (err) => toast.error(shopsErrorMessage(err)),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (fileId: string) => removeDigitalFile(fileId),
    onError: (err) => toast.error(shopsErrorMessage(err)),
    onSettled: refresh,
  });
  // S2-005: a file whose upload was cut off before its check stays waiting and blocks Publish; it is shown, with
  // "Try again" (check it again) and Remove, instead of hidden.
  const retry = useMutation({
    mutationFn: (fileId: string) => confirmDigitalFile(fileId),
    onSuccess: () => toast("File added."),
    onError: (err) => toast.error(shopsErrorMessage(err)),
    onSettled: refresh,
  });
  const open = useMutation({
    mutationFn: (fileId: string) => digitalDownloadUrl(fileId),
    onSuccess: (url) => window.open(url, "_blank", "noopener"),
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });

  const list = files.data ?? [];
  const busy = add.isPending || remove.isPending || retry.isPending;
  const full = (files.data ?? []).length >= DIGITAL_MAX_FILES;

  return (
    <section className="space-y-2" aria-labelledby="item-digital-files" data-testid="shop-digital-files">
      <h4 id="item-digital-files" className="text-ds-13 font-medium">Files buyers download (1 to {DIGITAL_MAX_FILES})</h4>
      <p className="text-ds-11 text-muted-foreground">
        PDF, ZIP, PNG or JPG, up to 100 MB each. Buyers can download them as soon as they pay, for as long as they have
        an account. Your photos above are the preview; the files stay private.
      </p>
      {files.isError && (
        <div role="alert" className="space-y-1">
          <ReportErrorScreen source="ShopDigitalFiles.list" title="We couldn't load your files." />
          <p className="text-ds-13 text-destructive-ink">We couldn't load your files.</p>
          <Button type="button" size="sm" variant="outline" onClick={() => void files.refetch()}>Try again</Button>
        </div>
      )}
      {list.length > 0 && (
        <ul className="space-y-2">
          {list.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border px-3 py-2">
              <FileDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-ds-13">{f.file_name}</span>
              {f.checked_at ? (
                <>
                  <span className="text-ds-11 text-muted-foreground">{fileSizeLabel(f.byte_size)}</span>
                  <Button type="button" size="sm" variant="ghost" disabled={open.isPending} onClick={() => open.mutate(f.id)}>
                    Open
                  </Button>
                </>
              ) : (
                <>
                  <span className="text-ds-11 text-muted-foreground" data-testid="shop-digital-file-waiting">Still checking</span>
                  <Button type="button" size="sm" variant="ghost" disabled={busy} aria-label={`Try ${f.file_name} again`} onClick={() => retry.mutate(f.id)}>
                    Try again
                  </Button>
                </>
              )}
              <Button type="button" size="sm" variant="outline" disabled={busy} aria-label={`Remove ${f.file_name}`} onClick={() => remove.mutate(f.id)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      {!full && (
        <label className="inline-flex">
          <span className="sr-only">Add a file</span>
          <HiddenFileInput
            peer
            accept={DIGITAL_FILE_ACCEPT}
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) add.mutate(f);
            }}
          />
          {/* S2-012: keyboard focus shows on the visible control (peer ring). */}
          <span className="inline-flex h-11 cursor-pointer items-center rounded-md border border-input bg-background px-3 text-ds-13 peer-focus-visible:ring-2 peer-focus-visible:ring-ring" aria-hidden>
            {add.isPending ? "Uploading…" : "Add a file"}
          </span>
        </label>
      )}
    </section>
  );
}
