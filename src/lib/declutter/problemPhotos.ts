/**
 * Audit 1b D2-7: up to 3 photos on the problem form and the refund-request form. The picker is built; each form shows
 * it only once the server takes the photos there. Both flags are bound to the migrations by
 * src/test/problemPhotosWaitForServer.test.ts (two-way: false while the server refuses, true once it accepts), so
 * the day the server side lands on main the guard goes red until the flag is flipped, and a flag flipped early is red.
 *
 * Measured on prod 2026-10-29 (pg_get_functiondef, read-only):
 *   - declutter_handover_photo_access(name, p_write => true) lets a member upload only while the order's status is
 *     'paid'. The owner ruled "Report a problem" is not offered while an order waits for pickup, so the problem form
 *     shows on handed-over orders only (inside the refund panel), where every upload is refused today.
 *   - declutter_ask_refund(uuid, text, text) takes no photos.
 * Server side: Builder 44 (Declutter problems and refunds). D2-3 (20261029225634) lets the problem folder take uploads
 * after the handover while a problem can be reported, a refund request waits or a problem is open, and
 * declutter_ask_refund takes p_photo_paths: both pickers are on (train 1029y).
 */

/** At most this many photos on either form (declutter_report_problem allows 6). */
export const PROBLEM_PHOTO_MAX = 3;

/** The problem form: the storage rule lets a party upload into the problem folder after the handover, in the window. */
export const PROBLEM_FORM_PHOTOS_READY = true;

/** The refund-request form: the above, and declutter_ask_refund takes p_photo_paths. */
export const REFUND_FORM_PHOTOS_READY = true;
