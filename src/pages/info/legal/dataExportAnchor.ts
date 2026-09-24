/**
 * The id of the "Download your data" card (DataExportCard) and the two places
 * it lives. Its own module, with no imports. (The /data-rights redirect that
 * used to read it was deleted with Q194.)
 */
export const DATA_EXPORT_ANCHOR = "download-your-data";

/**
 * Where the export card lives for this reader.
 *
 * Signed in: the in-app Legal tab's Privacy panel (`?doc=privacy`, LegalTab),
 * which renders the same PrivacyContent — and therefore the same card — inside
 * the app's own navigation. The public /privacy page has no app nav (it is in
 * neither desktopNavRoutes' AUTH_PREFIXES nor mobileNavHelpers' authPages), so
 * sending a signed-in reader there is the bounce out of the app the owner has
 * forbidden (2026-08-30).
 *
 * Signed out: the public Privacy Policy, where the card offers sign-in.
 */
export const dataRightsTarget = (signedIn: boolean): string =>
  signedIn
    ? `/profile?tab=legal&doc=privacy#${DATA_EXPORT_ANCHOR}`
    : `/privacy#${DATA_EXPORT_ANCHOR}`;
