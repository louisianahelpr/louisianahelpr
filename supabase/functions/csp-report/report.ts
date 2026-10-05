// Pure parsing for csp-report: no Deno, no network, no imports. index.ts owns
// the request and the insert; this file decides what a report body means.
//
// Browsers send violations in two shapes:
//   - `report-uri` (every engine): Content-Type application/csp-report, body
//     `{"csp-report": {"document-uri": ..., "blocked-uri": ..., ...}}`.
//   - `report-to` + Reporting-Endpoints (Chromium; Safari): Content-Type
//     application/reports+json, body `[{"type": "csp-violation", "url": ...,
//     "body": {"documentURL": ..., "blockedURL": ..., ...}}, ...]`, possibly
//     batched with other report types (which are ignored here).

/**
 * Bodies larger than this are refused (413) before they are parsed. 64 KB, not
 * less: every Reporting API entry carries the whole `originalPolicy` (~1.5 KB
 * for ours), so a real batch of 4 entries is ~8.6 KB, and an 8 KB cap dropped
 * exactly the batches that say a script was blocked (lh-authz-rls review of
 * Q1318, measured 8617 B for 4 entries). MAX_ENTRIES x ~3 KB fits.
 */
export const MAX_BODY_BYTES = 64 * 1024;
/** Reporting API batches are read up to this many entries. */
const MAX_ENTRIES = 20;
/** At most this many violations are kept in the row's context. */
const MAX_CONTEXT_REPORTS = 5;

const REPORT_MEDIA_TYPES = new Set([
  "application/csp-report",
  "application/reports+json",
  "application/json",
]);

export interface Violation {
  documentURL: string;
  blockedURL: string;
  effectiveDirective: string;
  disposition: string;
  sourceFile: string;
  lineNumber: number | null;
  columnNumber: number | null;
  sample: string;
  statusCode: number | null;
}

export type ParseResult =
  | { ok: true; violations: Violation[] }
  | { ok: false; status: 400 | 415; reason: string };

function str(v: unknown, max = 300): string {
  if (typeof v !== "string") return "";
  // Control characters never belong in a URL or a directive name.
  return v.replace(/[\u0000-\u001F\u007F-\u009F]/g, "").trim().slice(0, max);
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null;
}

/**
 * A URL without its query string or fragment. Document URLs carry tokens
 * (password-reset and magic links), and error_logs is not where they belong.
 * Keyword values (`inline`, `eval`, `data`) pass through unchanged.
 */
function stripUrl(u: string): string {
  if (!u) return "";
  try {
    const parsed = new URL(u);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return (parsed.origin + parsed.pathname).slice(0, 300);
    }
    return `${parsed.protocol}`.slice(0, 300);
  } catch {
    // Not a URL. Keep it only when it is a keyword a browser really sends in
    // blocked-uri; anything else is caller-chosen text that would reach the
    // ops digest verbatim (Slack mrkdwn like "<!channel>"), so it is dropped
    // (lh-authz-rls review of Q1318).
    const bare = u.trim();
    return BLOCKED_KEYWORD.test(bare) ? bare : "(invalid)";
  }
}

/** blocked-uri values that are keywords, not URLs (CSP3 + the legacy scheme-only forms). */
const BLOCKED_KEYWORD = /^(inline|eval|wasm-eval|trusted-types-policy|trusted-types-sink|self|blob|data|about|filesystem|mediastream)$/i;

/** A directive name is lowercase letters and dashes; anything else is not one. */
function directiveName(d: string): string {
  return /^[a-z-]{1,60}$/.test(d) ? d : "";
}

function fromLegacy(r: Record<string, unknown>): Violation {
  return {
    documentURL: str(r["document-uri"], 2000),
    blockedURL: str(r["blocked-uri"], 2000),
    effectiveDirective: directiveName(str(r["effective-directive"] ?? r["violated-directive"], 100).split(/\s+/, 1)[0]),
    disposition: str(r["disposition"], 20) || "enforce",
    sourceFile: str(r["source-file"], 2000),
    lineNumber: num(r["line-number"]),
    columnNumber: num(r["column-number"]),
    sample: str(r["script-sample"], 200),
    statusCode: num(r["status-code"]),
  };
}

function fromReportingApi(entry: Record<string, unknown>): Violation | null {
  if (entry.type !== "csp-violation") return null;
  const b = entry.body;
  if (!b || typeof b !== "object" || Array.isArray(b)) return null;
  const r = b as Record<string, unknown>;
  return {
    documentURL: str(r.documentURL ?? entry.url, 2000),
    blockedURL: str(r.blockedURL, 2000),
    effectiveDirective: directiveName(str(r.effectiveDirective, 100)),
    disposition: str(r.disposition, 20) || "enforce",
    sourceFile: str(r.sourceFile, 2000),
    lineNumber: num(r.lineNumber),
    columnNumber: num(r.columnNumber),
    sample: str(r.sample, 200),
    statusCode: num(r.statusCode),
  };
}

/** Parse a report body. Never throws. */
export function parseReports(contentType: string | null, body: string): ParseResult {
  const mediaType = (contentType ?? "").split(";", 1)[0].trim().toLowerCase();
  if (!REPORT_MEDIA_TYPES.has(mediaType)) {
    return { ok: false, status: 415, reason: `unsupported content type ${mediaType || "(none)"}` };
  }
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return { ok: false, status: 400, reason: "body is not JSON" };
  }
  if (Array.isArray(data)) {
    const violations = data
      .slice(0, MAX_ENTRIES)
      .filter((e): e is Record<string, unknown> => !!e && typeof e === "object" && !Array.isArray(e))
      .map(fromReportingApi)
      .filter((v): v is Violation => v !== null);
    return { ok: true, violations };
  }
  if (data && typeof data === "object") {
    const inner = (data as Record<string, unknown>)["csp-report"];
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      return { ok: true, violations: [fromLegacy(inner as Record<string, unknown>)] };
    }
  }
  return { ok: false, status: 400, reason: "not a CSP report" };
}

// Browser extensions inject scripts, styles and frames into every page they
// run on; the page's CSP blocks them and the browser reports it. None of that
// is ours. `about`/`data` cover about:blank frames and data: payloads (the
// legacy shape sends the bare scheme, without a colon, for some of them).
const NOISE_URL = /^(moz-extension|chrome-extension|safari-extension|safari-web-extension|ms-browser-extension|webkit-masked-url|about|data):/i;
const NOISE_KEYWORD = /^(about|data)$/i;

function noisy(u: string): boolean {
  return NOISE_URL.test(u) || NOISE_KEYWORD.test(u);
}

/** True when the violation is extension or browser noise, not our page. */
export function isNoise(v: Violation): boolean {
  if (noisy(v.blockedURL) || noisy(v.sourceFile)) return true;
  // A report about a document that is not a web page (an extension's own
  // page, about:blank) is not about this site.
  return !/^https?:\/\//i.test(v.documentURL);
}

export interface ErrorLogRow {
  severity: "warning";
  message: string;
  url: string | null;
  user_agent: string | null;
  tags: Record<string, string>;
  context: Record<string, unknown>;
}

/**
 * ONE error_logs row for one request, however many violations it carried.
 * `warning`: the row is written as `anon`, so stamp_error_log_origin marks it
 * origin 'client' and notify_slack_on_error_log never posts it at any
 * severity; warning keeps it out of "error" counts in the admin health view.
 */
export function toErrorLogRow(kept: Violation[], dropped: number, userAgent: string | null): ErrorLogRow {
  const first = kept[0];
  const blocked = stripUrl(first.blockedURL) || "(none)";
  const directive = first.effectiveDirective || "(unknown)";
  const reportOnly = first.disposition === "report" ? "report-only " : "";
  return {
    severity: "warning",
    message: `CSP ${reportOnly}violation: ${directive} blocked ${blocked}`.slice(0, 300),
    url: stripUrl(first.documentURL) || null,
    user_agent: userAgent ? userAgent.slice(0, 512) : null,
    tags: { source: "csp", directive, blocked, disposition: first.disposition },
    context: {
      report_count: kept.length,
      noise_dropped: dropped,
      reports: kept.slice(0, MAX_CONTEXT_REPORTS).map((v) => ({
        directive: v.effectiveDirective,
        blocked: stripUrl(v.blockedURL),
        document: stripUrl(v.documentURL),
        source_file: stripUrl(v.sourceFile),
        line: v.lineNumber,
        column: v.columnNumber,
        sample: v.sample,
        status: v.statusCode,
        disposition: v.disposition,
      })),
    },
  };
}
