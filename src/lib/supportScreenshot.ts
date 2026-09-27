/**
 * The "Screenshot: <path>" line a support ticket carries in
 * `reports.description` — written by SupportInline, read by AdminSupport.
 *
 * It holds the user-documents STORAGE PATH (`<uid>/support/<ms>.<ext>`), never
 * a signed URL. Until 2026-09-27 SupportInline pasted a 30-day signed URL here,
 * a token that 400s after its `exp` (src/test/noPersistedSignedUrls.test.ts);
 * the admin screen now signs the path at click time instead.
 *
 * Both sides import this one module, so the line format cannot drift between
 * the writer and the reader.
 */
import { isStorageObjectPath } from "@/lib/storagePath";

const PREFIX = "Screenshot: ";

/** The folder a support screenshot lives in, under the reporter's own uid. */
export function supportScreenshotPath(userId: string, ext: string, now = Date.now()): string {
  return `${userId}/support/${now}.${ext}`;
}

/** The description a ticket is filed with. */
export function withSupportScreenshot(message: string, path: string | null): string {
  return path ? `${message}\n\n${PREFIX}${path}` : message;
}

/**
 * Split a stored description into its text and the screenshot path.
 *
 * The path is only returned when it sits in THE REPORTER'S OWN
 * `<reporter>/support/` folder. The description is free text the reporter
 * typed, so a line "Screenshot: <someone else>/credentials/id.png" is theirs to
 * write; admins can read the whole bucket, and without this check the button
 * would open another user's document labelled as this reporter's screenshot.
 * Anything else stays in the text, untouched.
 */
export function splitSupportScreenshot(
  description: string,
  reporterId: string | null,
): { body: string; path: string | null } {
  if (!reporterId) return { body: description, path: null };
  const idx = description.lastIndexOf(`\n\n${PREFIX}`);
  if (idx === -1) return { body: description, path: null };
  const candidate = description.slice(idx + 2 + PREFIX.length).trim();
  // EXACT shape only: `<reporter>/support/<digits>.<ext>`. A prefix check is
  // not enough — storage-js puts the path into the sign URL unencoded, and the
  // URL parser resolves `%2e%2e` as `..`, so `<me>/support/%2e%2e/%2e%2e/<other>/x`
  // would sign another user's object (lh-authz-rls review, 2026-09-27).
  const ok =
    isStorageObjectPath(candidate) &&
    candidate.startsWith(`${reporterId}/support/`) &&
    /^\d+\.[a-z0-9]{1,8}$/.test(candidate.slice(`${reporterId}/support/`.length));
  if (!ok) return { body: description, path: null };
  return { body: description.slice(0, idx), path: candidate };
}
