/**
 * The only URL an <img> may show for a photo the member just picked: one URL.createObjectURL made for a local File
 * (a "blob:" URL). Anything else (a javascript:, data: or remote URL that reached the same variable) is refused, so
 * the preview can never become a script or a request to somewhere else. This is why CodeQL's
 * xss-through-dom alerts on the porch-photo preview are false positives (lead 2026-10-21: keep the reasoning in code).
 */
export function safeBlobUrl(url: string | null | undefined): string | null {
  return typeof url === "string" && url.startsWith("blob:") ? url : null;
}
