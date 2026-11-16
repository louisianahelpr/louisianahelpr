import { forwardRef, type ButtonHTMLAttributes } from "react";
import { FileText, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A square file tile you tap to open (a portfolio PDF or Word file in the admin Documents tab), the file twin of
 * PhotoTileButton: one shared tile instead of a hand-made <button> per screen (OWN-SHARED, owner 10-31: "Nothing
 * hand-made"). A file icon over the file name, the neutral hover tint (`.ctl-tint`), the app's one press and focus
 * ring. Named "Open <fileName>" for screen readers; `busy` swaps the icon for a spinner and disables the tile while
 * the caller signs a private URL. The caller opens its own viewer in onClick (useDocumentViewer).
 */
type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "children"> & { fileName: string; busy?: boolean };

export const FileTileButton = forwardRef<HTMLButtonElement, Props>(({ fileName, busy = false, className, disabled, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    aria-label={`Open ${fileName}`}
    disabled={disabled || busy}
    aria-busy={busy || undefined}
    {...props}
    className={cn(
      "aspect-square rounded-ds-md border border-border flex flex-col items-center justify-center bg-secondary/30 px-2 ctl-tint active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50",
      className,
    )}
  >
    {busy ? <Loader2 className="w-6 h-6 text-muted-foreground mb-1 animate-spin" aria-hidden /> : <FileText className="w-6 h-6 text-muted-foreground mb-1" aria-hidden />}
    <span title={fileName} className="block text-muted-foreground text-ds-11 text-center truncate w-full">{fileName}</span>
  </button>
));
FileTileButton.displayName = "FileTileButton";
