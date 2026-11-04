import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, FileText, X, AlertTriangle } from "lucide-react";
import { formatBytes, KIND_NOUN, KIND_NOUN_TITLE, type CredState, type Draft, type Kind } from "./credentialKinds";

/**
 * One credential's card on Licensed & Insured (license or insurance), moved out of CredentialsTab.tsx unchanged
 * (Q806, the god-component ratchet). CredentialsTab owns every state and handler; the card renders them.
 */
export function CredentialCard({
  kind,
  url,
  reason,
  state,
  draft,
  on,
  removing,
  addInputRefs,
  attachDoc,
  setIntent,
  discardDraft,
  openDoc,
  setPullBack,
}: {
  kind: Kind;
  url: string | null;
  reason: string | null;
  state: CredState;
  draft: Draft | undefined;
  on: boolean;
  removing: boolean;
  addInputRefs: MutableRefObject<Partial<Record<Kind, HTMLInputElement | null>>>;
  attachDoc: (file: File, kind: Kind) => boolean;
  setIntent: Dispatch<SetStateAction<Partial<Record<Kind, boolean>>>>;
  discardDraft: (kind: Kind) => void;
  openDoc: (path: string) => void;
  setPullBack: (kind: Kind) => void;
}) {
const noun = KIND_NOUN[kind];

  return (
    <div className="rounded-[20px] liquid-glass p-card space-y-4">
      <div className="min-w-0">
        {/* Status eyebrow removed (owner, 2026-08-29: "delete globally"). */}
        <h3
          className="font-sans font-bold leading-tight text-headline-card"
          style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
        >
          {kind === "license" ? "Professional license" : "Insurance"}
        </h3>
        <p className="font-sans mt-1 text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
          {!on
            ? kind === "license"
              ? "Hold a professional license? Add it and send it for review to earn the badge."
              : "Carry professional insurance? Add your Certificate of Insurance (COI) and send it for review to earn the badge."
            : kind === "license"
              ? "Attach your professional license, then send it for review to earn the badge."
              : "Attach your Certificate of Insurance (COI), then send it for review to earn the badge."}
        </p>
      </div>

      {/* THE "ADD" BUTTON (owner, 2026-09-23, MORNING QUESTIONS 6 option b,
          Q142). This was an "I Am Licensed" / "I Am Insured" SWITCH, which
          looked like it set the badge. It never could: `is_licensed` /
          `is_insured` are server-owned (`prevent_self_escalation()` puts a
          member's write back, measured on prod 2026-09-23, Q99), and
          `trg_auto_pending_credentials` turns them on only when a document
          is SENT. So the control now says what it does: it opens the file
          picker, straight into the existing attach -> "Send for review"
          flow, and writes nothing itself.

          It is also where withdrawing a sent document leaves you (Q111):
          taking a copy back resets the row to is_<kind> = false, so the card
          returns here with the way to add a new one on screen, as the
          withdraw dialog promises. */}
      {!on && (
        <>
          <Button
            variant="outline"
            size="sm"
            className="w-full rounded-full"
            onClick={() => addInputRefs.current[kind]?.click()}
          >
            <Upload className="w-4 h-4" />
            {kind === "license" ? "Add license" : "Add insurance"}
          </Button>
          <Input
            ref={(el) => { addInputRefs.current[kind] = el; }}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            data-credential-add={kind}
            aria-label={kind === "license" ? "Choose your license document" : "Choose your insurance document"}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f || !attachDoc(f, kind)) return;
              // Local only, like every attached draft: the card opens on the
              // file you picked, and nothing reaches the server until Send.
              setIntent((prev) => ({ ...prev, [kind]: true }));
            }}
          />
        </>
      )}

      {on && (
        <div className="space-y-3">
          {draft ? (
            // ── Attached, NOT sent ──────────────────────────────────────
            <div
              className="flex items-center gap-3 rounded-ds-md p-3"
              style={{
                background: "hsl(var(--ivory-sand) / 0.55)",
                border: "0.5px dashed hsl(var(--bark) / 0.45)",
              }}
            >
              {draft.previewUrl ? (
                <img
                  src={draft.previewUrl}
                  alt={`Preview of the ${noun} you attached`}
                  className="w-10 h-10 rounded-ds-sm object-cover shrink-0"
                  style={{ border: "0.5px solid hsl(var(--olivewood) / 0.16)" }}
                />
              ) : (
                <FileText className="w-5 h-5 text-primary shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-ds-13 font-medium text-foreground truncate">{draft.file.name}</p>
                <p className="text-ds-11 font-sans" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                  {formatBytes(draft.file.size)} · on this device only — not sent yet
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => discardDraft(kind)}
                aria-label={`Remove the ${noun} you attached — it hasn't been sent`}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          ) : url ? (
            // ── Sent ────────────────────────────────────────────────────
            <div className="flex items-center gap-3 rounded-ds-md bg-card p-3">
              <FileText className="w-5 h-5 text-primary shrink-0" />
              <button
                type="button"
                onClick={() => openDoc(url)}
                className="flex-1 min-w-0 text-left text-ds-13 text-primary underline break-words"
              >
                View the {KIND_NOUN_TITLE[kind].toLowerCase()} you sent
              </button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setPullBack(kind)}
                disabled={removing}
                aria-label={
                  state === "review"
                    ? `Take your ${noun} out of the review queue`
                    : state === "verified"
                      ? `Remove your verified ${noun} and its badge`
                      : `Remove the ${noun} we couldn't verify`
                }
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          ) : null}

          {/* Attach / replace. A rejected document keeps its row above (so
              the user can see what we looked at) AND gets a fresh picker,
              rather than forcing a delete-then-upload dance. */}
          {!draft && (!url || state === "rejected") && (
            <label className="glass-field flex items-center justify-center gap-2 rounded-ds-md border-2 border-dashed border-[hsl(var(--border)/0.6)] px-4 py-6 cursor-pointer hover:border-primary/40 transition-colors">
              <Upload className="w-5 h-5 text-muted-foreground" />
              <span className="text-ds-13 font-medium">
                {state === "rejected"
                  ? `Attach a new ${noun} (image or PDF)`
                  : `Attach ${kind === "license" ? "license" : "insurance"} (image or PDF)`}
              </span>
              <Input
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) attachDoc(f, kind);
                  e.target.value = "";
                }}
              />
            </label>
          )}

          {/* Only the REASON, never a second copy of the status word — the
              eyebrow above already named the state. */}
          {state === "rejected" && reason && (
            <p className="inline-flex items-start gap-1.5 text-ds-11 text-[hsl(var(--destructive-ink))]/90">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{reason}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
