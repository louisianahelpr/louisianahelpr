import { Camera, Image as ImageIcon, FilePlus2, MapPin, AudioLines } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { MESSAGE_ATTACHMENT_MAX_BYTES } from "@/lib/messageAttachments";

interface AttachSourceSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPickCamera: () => void;
  onPickLibrary: () => void;
  onPickFiles: () => void;
  /** Share current location — moved here when the composer collapsed to "+". */
  onShareLocation: () => void;
  /** Start a voice note — likewise moved in from the composer row. */
  onRecordVoiceNote: () => void;
  voiceNoteDisabled?: boolean;
  /** Job quick-replies, shown above the send-something actions. */
  quickReplies?: React.ReactNode;
}

/**
 * Quick-attach bottom sheet — three explicit sources (Camera, Library,
 * Files). The user picks where the attachment comes from in one tap rather
 * than fighting an OS picker that may default to the wrong tab. iMessage
 * convention: a sheet with named source buttons, not a single "open" intent.
 */
export const AttachSourceSheet = ({
  open, onOpenChange, onPickCamera, onPickLibrary, onPickFiles,
  onShareLocation, onRecordVoiceNote, voiceNoteDisabled = false, quickReplies,
}: AttachSourceSheetProps) => {
  // Wrap each action so picking one closes the sheet — otherwise it stays
  // open behind the OS picker / permission prompt it just triggered.
  const pick = (fn: () => void) => () => { onOpenChange(false); fn(); };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom">
        {/* Radix points the dialog's `aria-labelledby` at a Title, so a sheet
            with none announces as a bare "dialog". This one is deliberately
            headerless (below), which is a visual decision, not a naming one —
            the name still has to exist. Same fix Navbar and ui/sidebar use for
            their nav drawers. */}
        <SheetTitle className="sr-only">Attach</SheetTitle>
        {/* iOS "+" menu shape: one uniform vertical list, each row a circular
            icon and a label. No headline — iMessage's sheet doesn't ask a
            question, it just lists what you can attach.

            The previous version was a serif "What are you sending?" over a
            three-up tile grid and then a two-up row, so five actions of equal
            standing were drawn three different ways and the eye had to learn
            two layouts to read one menu. */}
        {quickReplies && (
          <div className="pt-1 pb-3">
            <div onClick={() => onOpenChange(false)}>{quickReplies}</div>
          </div>
        )}
        <div
          className="rounded-ds-md overflow-hidden"
          style={{ background: "var(--surface-premium)", border: "0.5px solid hsl(var(--olivewood) / 0.14)" }}
        >
          {([
            { key: "camera", label: "Camera", Icon: Camera, onPick: onPickCamera, tint: "bark" },
            { key: "library", label: "Photo Library", Icon: ImageIcon, onPick: onPickLibrary, tint: "sienna" },
            { key: "files", label: "Files", Icon: FilePlus2, onPick: onPickFiles, tint: "sienna" },
            { key: "location", label: "Location", Icon: MapPin, onPick: onShareLocation, tint: "bark" },
            { key: "voice", label: "Voice note", Icon: AudioLines, onPick: onRecordVoiceNote, tint: "bark", disabled: voiceNoteDisabled },
          ] as const).map((row, i) => {
            const tintFg = row.tint === "bark" ? "hsl(var(--bark))" : "hsl(var(--burnt-sienna))";
            const tintBg = row.tint === "bark" ? "hsl(var(--bark) / 0.10)" : "hsl(var(--burnt-sienna) / 0.14)";
            return (
              <button
                key={row.key}
                type="button"
                onClick={pick(row.onPick)}
                disabled={"disabled" in row ? row.disabled : false}
                className="w-full min-h-[56px] flex items-center gap-3 px-4 text-left transition-colors hover:bg-secondary/40 active:bg-secondary/60 disabled:opacity-40 disabled:pointer-events-none"
                style={i > 0 ? { borderTop: "0.5px solid hsl(var(--olivewood) / 0.12)" } : undefined}
              >
                <span
                  className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: tintBg, border: `1px solid ${tintFg}38` }}
                >
                  <row.Icon className="w-4 h-4" style={{ color: tintFg }} />
                </span>
                <span className="font-sans text-ds-14 font-medium" style={{ color: "hsl(var(--ink-deep))" }}>
                  {row.label}
                </span>
              </button>
            );
          })}
        </div>
        <p
          className="mt-3 font-serif italic text-ds-12 leading-relaxed text-center"
          style={{ color: "hsl(var(--olivewood) / 0.8)" }}
        >
          Up to {Math.round(MESSAGE_ATTACHMENT_MAX_BYTES / 1024 / 1024)}MB ·
          photos and PDFs only.
        </p>
      </SheetContent>
    </Sheet>
  );
};
