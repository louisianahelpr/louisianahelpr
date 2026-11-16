/**
 * What the in-app document viewer (src/components/documents/DocumentViewer.tsx) does with a stored file, decided from
 * its path, URL or file name (owner 2026-11-15: "add the PDF viewer too"; a document no longer opens the raw storage
 * URL in a new tab). Guard: src/test/documentsOpenInApp.test.tsx.
 *
 *   image  a picture every browser draws in an <img>
 *   heic   an iPhone photo: Safari draws it, Chrome does not, so the viewer tries and falls back to a Download card
 *   pdf    drawn page by page with pdf.js (loaded only when the viewer opens)
 *   word   .doc / .docx: no browser draws them, so a card with the file name and Download
 *   other  anything else: the same card
 */
export type DocumentKind = "image" | "heic" | "pdf" | "word" | "other";

/** The bare file part of a path or URL, without the query string or the hash. */
function fileOf(value: string): string {
  const v = value.trim().split("#")[0].split("?")[0];
  return v.slice(v.lastIndexOf("/") + 1);
}

export function documentKind(value: string | null | undefined, name?: string | null): DocumentKind {
  if (typeof value !== "string") return "other";
  const v = value.trim();
  if (/^data:image\/(png|jpe?g|gif|webp);/i.test(v)) return "image";
  if (/^data:application\/pdf[;,]/i.test(v)) return "pdf";
  // A blob: or signed URL can hide its type; the caller's file name says it.
  const files = [fileOf(v), name ? fileOf(name) : ""];
  const has = (re: RegExp) => files.some((f) => re.test(f));
  if (has(/\.pdf$/i)) return "pdf";
  if (has(/\.(jpe?g|png|gif|webp|avif)$/i)) return "image";
  if (has(/\.(heic|heif)$/i)) return "heic";
  if (has(/\.docx?$/i)) return "word";
  return "other";
}

/**
 * The file name to show and to save as: the caller's name, else the last path segment, else "Document". A caller's
 * name with no extension ("Front", "Credential document") takes the file's own, so a download saves as "Front.pdf".
 */
export function documentName(value: string | null | undefined, name?: string | null): string {
  const n = name?.trim();
  if (n) {
    if (/\.[a-z0-9]{2,5}$/i.test(n) || typeof value !== "string") return n;
    const ext = /\.([a-z0-9]{2,5})$/i.exec(fileOf(value))?.[1];
    return ext ? `${n}.${ext.toLowerCase()}` : n;
  }
  if (typeof value !== "string" || /^(data|blob):/i.test(value.trim())) return "Document";
  let f = fileOf(value);
  try {
    f = decodeURIComponent(f);
  } catch {
    // A stray % in the name: the raw segment is still a usable name, nothing is lost.
  }
  return f || "Document";
}

/**
 * The URL that SAVES the file instead of showing it. A Supabase Storage URL (signed or public) takes `download=<name>`
 * and answers with `Content-Disposition: attachment`; any other URL is returned as it is.
 */
export function downloadUrl(url: string, name: string): string {
  try {
    const u = new URL(url);
    if (!/\/storage\/v1\/object\//.test(u.pathname)) return url;
    u.searchParams.set("download", name);
    return u.toString();
  } catch {
    // Not an absolute URL (a blob: or data: URL parses, so this is a relative path): returned as it is.
    return url;
  }
}
