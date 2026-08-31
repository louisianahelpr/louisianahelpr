import { type RefObject } from "react";
import { Camera, Image as ImageIcon, FilePlus2, MapPin, AudioLines } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
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
  /**
   * The composer's "+" button that opens this panel — see FilterSheet.tsx
   * for the `virtualRef` pattern this follows. RichMessageInput owns the
   * button; this panel is anchored against it via Radix Popper's
   * `virtualRef` rather than a `<PopoverTrigger>` subtree, same reasoning
   * as FilterSheet's anchorRef.
   */
  anchorRef: RefObject<HTMLElement | null>;
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
  anchorRef,
}: AttachSourceSheetProps) => {
  // Wrap each action so picking one closes the sheet — otherwise it stays
  // open behind the OS picker / permission prompt it just triggered.
  const pick = (fn: () => void) => () => { onOpenChange(false); fn(); };
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        collisionPadding={16}
        aria-label="Attach"
        className="w-[300px] max-w-[calc(100vw-2rem)] max-h-[70vh] overflow-y-auto overscroll-contain p-4 rounded-ds-lg"
        style={{ background: "var(--surface-premium)" }}
        // The "+" button is OUTSIDE the popover subtree, so Radix counts a
        // click on it as an outside-dismiss — which would close the panel
        // and then let the button's own onClick toggle it straight back
        // open. Let the button keep sole ownership of the toggle, same
        // guard FilterSheet uses for the Filters button.
        onInteractOutside={(e) => {
          const target = e.target as Node | null;
          if (target && anchorRef.current?.contains(target)) e.preventDefault();
        }}
      >
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
                // Voice note records and sends an audio CLIP as its own
                // attachment — distinct from the composer's mic "Dictate"
                // button, which transcribes speech INTO the text draft and
                // sends nothing until you tap Send (see the fuller note on
                // that button in RichMessageInput.tsx). One-line hint here
                // since this menu is the more likely place to wonder "wait,
                // isn't there already a mic icon?"
                title={row.key === "voice" ? "Records and sends an audio clip (the mic icon in the composer instead types out what you say)" : undefined}
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
      </PopoverContent>
    </Popover>
  );
};
