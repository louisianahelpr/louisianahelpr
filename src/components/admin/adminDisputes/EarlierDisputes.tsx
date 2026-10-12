import type { DisputeRecord } from "./types";

const STATUS_WORD: Record<DisputeRecord["status"], string> = {
  open: "Open",
  decided: "Decided",
  withdrawn: "Withdrawn",
  superseded: "Replaced by a later dispute",
};

/**
 * Q1327: the job's EARLIER disputes, under the current one. A re-file keeps
 * the previous dispute's row with the Helpr's answer archived on it
 * (disputes.helper_response, 20261005064816), and the card used to show only
 * the newest record, so the admin never saw what the Helpr said the first
 * time. Collapsed: the current dispute is still the one being decided.
 */
export function EarlierDisputes({ records }: { records: DisputeRecord[] | undefined }) {
  if (!records || records.length === 0) return null;
  return (
    <details className="rounded-ds-sm border border-border p-3" data-testid="earlier-disputes">
      <summary className="text-ds-13 text-foreground font-medium cursor-pointer">
        Earlier disputes on this job ({records.length})
      </summary>
      <ul className="mt-2 space-y-3">
        {records.map((r) => (
          <li key={r.id} className="text-ds-11 text-muted-foreground space-y-1">
            <p className="text-foreground font-medium">
              {STATUS_WORD[r.status] ?? r.status}
              <span className="ml-1 text-ds-10 text-muted-foreground font-normal">
                · filed {new Date(r.created_at).toLocaleString("en-US")}
              </span>
            </p>
            {r.reason && <p className="break-words">Reason: "{r.reason}"</p>}
            {r.decision_text && <p className="break-words">Decision: "{r.decision_text}"</p>}
            <p className="break-words">
              Helpr's answer: {r.helper_response ? `"${r.helper_response}"` : "none on record"}
            </p>
          </li>
        ))}
      </ul>
    </details>
  );
}
