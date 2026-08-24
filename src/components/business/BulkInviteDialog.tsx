// Bulk CSV invite for business teams.
//
// Owner drops a CSV with `email,role` rows into the upload zone, sees a
// preview, and on confirm we fan out invites against the existing
// business_members table + invite-email edge function. Per-row status
// is shown live (pending → sent → error) so a partial failure doesn't
// leave the owner guessing which addresses landed.

import { useCallback, useRef, useState } from "react";
import Papa from "papaparse";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHero,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Upload, Loader2, FileSpreadsheet, CheckCircle2, XCircle, Clock } from "lucide-react";
import { ROLE_LABEL } from "./roles";
import type { ExtendedRole } from "@/hooks/useMyBusiness";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import { toast } from "sonner";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type RowStatus = "pending" | "sending" | "sent" | "error";

interface ParsedRow {
  email: string;
  role: Exclude<ExtendedRole, "owner">;
  status: RowStatus;
  error?: string;
}

interface BulkInviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessId: string;
  invitedBy: string;
  remainingSlots: number;
  onComplete: () => void;
}

/**
 * Coerce a string into a valid extended role. Anything we don't
 * recognize falls back to "poster" — the most common default and the
 * value the existing UI used pre-migration.
 */
function normalizeRole(input: string): Exclude<ExtendedRole, "owner"> {
  const v = (input || "").trim().toLowerCase();
  if (v === "viewer" || v === "poster" || v === "approver" || v === "admin") return v;
  return "poster";
}

export function BulkInviteDialog({
  open,
  onOpenChange,
  businessId,
  invitedBy,
  remainingSlots,
  onComplete,
}: BulkInviteDialogProps) {
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [parsing, setParsing] = useState(false);
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setRows([]);
    setParsing(false);
    setSending(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleFile = (file: File) => {
    setParsing(true);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const seen = new Set<string>();
        const parsed: ParsedRow[] = [];
        for (const raw of result.data) {
          // Accept any-cased column name — CSV exporters love capitalizing.
          const lower: Record<string, string> = {};
          for (const k of Object.keys(raw)) {
            lower[k.toLowerCase().trim()] = String(raw[k] ?? "").trim();
          }
          const email = (lower.email || lower.address || "").toLowerCase();
          const role = normalizeRole(lower.role || lower.permission || "");
          if (!email) continue;
          if (seen.has(email)) continue;
          seen.add(email);
          const valid = EMAIL_RE.test(email);
          parsed.push({
            email,
            role,
            status: valid ? "pending" : "error",
            error: valid ? undefined : "Check this email address",
          });
        }
        setRows(parsed);
        setParsing(false);
      },
      error: (err) => {
        setParsing(false);
        hapticError();
        toast.error(`Couldn't parse that CSV: ${err.message}`);
      },
    });
  };

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  };

  const sendable = rows.filter((r) => r.status === "pending");
  const tooMany = sendable.length > remainingSlots;

  const handleConfirm = async () => {
    if (sendable.length === 0 || tooMany) return;
    setSending(true);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.status !== "pending") continue;
      setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, status: "sending" } : r)));

      // Insert the membership row; cast through any so the new
      // extended_role column compiles before regen of the supabase types.
      const insertPayload: any = {
        business_id: businessId,
        invited_email: row.email,
        role: "member",
        extended_role: row.role,
        status: "pending",
        invited_by: invitedBy,
      };

      const { error: insertErr } = await supabase
        .from("business_members")
        .insert(insertPayload);

      if (insertErr) {
        // If the new extended_role column doesn't exist yet (migration
        // unapplied on prod), retry without it so the seat still lands.
        const code = (insertErr as { code?: string }).code;
        const missingCol = code === "PGRST204" || code === "42703";
        if (missingCol) {
          delete insertPayload.extended_role;
          const retry = await supabase.from("business_members").insert(insertPayload);
          if (retry.error) {
            setRows((prev) =>
              prev.map((r, idx) =>
                idx === i ? { ...r, status: "error", error: retry.error!.message } : r,
              ),
            );
            continue;
          }
        } else {
          setRows((prev) =>
            prev.map((r, idx) =>
              idx === i ? { ...r, status: "error", error: insertErr.message } : r,
            ),
          );
          continue;
        }
      }

      // Email the invite. Best-effort: a failed send doesn't roll back
      // the row — the owner can resend from the members list.
      const { error: emailErr } = await supabase.functions.invoke(
        "send-business-invite-email",
        { body: { businessId, invitedEmail: row.email } },
      );

      setRows((prev) =>
        prev.map((r, idx) =>
          idx === i
            ? {
                ...r,
                status: emailErr ? "error" : "sent",
                error: emailErr ? "Email failed (seat saved)" : undefined,
              }
            : r,
        ),
      );
    }
    setSending(false);
    hapticSuccess();
    onComplete();
  };

  const sentCount = rows.filter((r) => r.status === "sent").length;
  const errorCount = rows.filter((r) => r.status === "error").length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHero
          eyebrow={
            <>
              <FileSpreadsheet className="w-3.5 h-3.5" /> Bulk invite
            </>
          }
          title="Bulk Invite by CSV"
        />

        {rows.length === 0 ? (
          <label
            className="flex flex-col items-center justify-center gap-2 rounded-ds-md border-2 border-dashed cursor-pointer py-10 transition-colors"
            style={{ borderColor: "hsl(var(--olivewood) / 0.25)" }}
          >
            <Upload className="w-6 h-6" style={{ color: "hsl(var(--bark))" }} />
            <span className="font-serif italic text-ds-13" style={{ color: "hsl(var(--olivewood))" }}>
              {parsing ? "Parsing…" : "Choose a CSV file"}
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={onPickFile}
              className="hidden"
              aria-label="Upload CSV"
            />
          </label>
        ) : (
          <div className="space-y-3 max-h-[50vh] overflow-y-auto">
            <div className="text-ds-11 text-muted-foreground flex items-center justify-between">
              <span>
                {rows.length} row{rows.length === 1 ? "" : "s"} parsed
                {sentCount > 0 && ` · ${sentCount} sent`}
                {errorCount > 0 && ` · ${errorCount} error${errorCount === 1 ? "" : "s"}`}
              </span>
              <button
                type="button"
                onClick={reset}
                className="underline hover:no-underline"
                disabled={sending}
              >
                Reset
              </button>
            </div>
            <table className="w-full text-ds-13">
              <thead>
                <tr className="text-left text-ds-11 text-muted-foreground">
                  <th className="font-medium py-1">Email</th>
                  <th className="font-medium py-1">Role</th>
                  <th className="font-medium py-1 text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr
                    key={`${r.email}-${idx}`}
                    className="border-t"
                    style={{ borderColor: "hsl(var(--olivewood) / 0.12)" }}
                  >
                    <td className="py-2 truncate max-w-[180px]" title={r.email}>
                      {r.email}
                    </td>
                    <td className="py-2">
                      <Badge variant="sienna" className="text-ds-10">
                        {ROLE_LABEL[r.role]}
                      </Badge>
                    </td>
                    <td className="py-2 text-right">
                      {r.status === "pending" && (
                        <Clock className="w-4 h-4 text-muted-foreground inline" />
                      )}
                      {r.status === "sending" && (
                        <Loader2 className="w-4 h-4 animate-spin inline" />
                      )}
                      {r.status === "sent" && (
                        <CheckCircle2
                          className="w-4 h-4 inline"
                          style={{ color: "hsl(var(--olivewood))" }}
                        />
                      )}
                      {r.status === "error" && (
                        <span className="inline-flex items-center gap-1">
                          <XCircle
                            className="w-4 h-4"
                            style={{ color: "hsl(var(--burnt-sienna))" }}
                          />
                          {r.error && (
                            <span
                              className="text-ds-10"
                              style={{ color: "hsl(var(--burnt-sienna))" }}
                              title={r.error}
                            >
                              {r.error.slice(0, 24)}
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {tooMany && (
              <p className="text-ds-11" style={{ color: "hsl(var(--burnt-sienna))" }}>
                {sendable.length} pending invites, but only {remainingSlots} seats remain. Upgrade
                first or trim the CSV.
              </p>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => handleClose(false)} disabled={sending}>
            Close
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={sending || sendable.length === 0 || tooMany}
          >
            {sending ? (
              <>
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Sending…
              </>
            ) : (
              `Send ${sendable.length} Invite${sendable.length === 1 ? "" : "s"}`
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default BulkInviteDialog;
