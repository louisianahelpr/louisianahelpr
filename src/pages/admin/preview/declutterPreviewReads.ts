/**
 * Audit 1102c P7 (Q2625): the read RPCs the Declutter views can make (src/lib/declutter, src/components/declutter,
 * src/lib/helprTasks), so the preview can say "Preview: not loaded (<name>)" for a read its sample does not answer and
 * keep "Preview: this would ..." for writes. Both kinds are answered without being sent either way; this only picks the words.
 * The list is exactly the RPCs those folders call that every migration declares STABLE or IMMUTABLE (Postgres refuses a
 * write inside one; scripts/audit/declaredReadRpcs.mjs). Guard, exact both ways:
 * src/pages/admin/preview/declutterPreviewReads.test.ts.
 */
export const DECLUTTER_PREVIEW_READ_RPCS: ReadonlySet<string> = new Set([
  "declutter_admin_open_problems", "declutter_admin_pending_items", "declutter_admin_problem_case",
  "declutter_admin_problem_talk", "declutter_admin_reported_items", "declutter_admin_reported_questions",
  "declutter_admin_reported_reviews", "declutter_admin_reported_wanted", "declutter_auto_free_days_state",
  "declutter_bundle_applies", "declutter_bundle_preview", "declutter_bundle_rule", "declutter_bundle_sellers",
  "declutter_checkout_porch_days", "declutter_chosen_meetup_hours", "declutter_delivery_open_times",
  "declutter_delivery_raise_status", "declutter_donation_partners_near", "declutter_dropped_into_budget",
  "declutter_free_requests_for_item", "declutter_guest_seller_card", "declutter_guest_seller_first_name", "declutter_has_agreed_sales",
  "declutter_haul_away_state", "declutter_helpr_job_listings", "declutter_i_reviewed", "declutter_item_address", "declutter_item_save_counts",
  "declutter_item_pickup_places", "declutter_item_pickup_windows", "declutter_item_questions",
  "declutter_keep_up_state", "declutter_listed_for_me", "declutter_listing_manage_state", "declutter_managed_overview",
  "declutter_manager_message_labels", "declutter_map_pins", "declutter_meetup_spot_suggestions",
  "declutter_meetup_spots_near", "declutter_my_cart", "declutter_my_donations", "declutter_my_free_pause",
  "declutter_my_handover", "declutter_my_item_review", "declutter_my_item_view_counts", "declutter_my_manager_grants", "declutter_my_meetup_spots",
  "declutter_my_move_out_date", "declutter_my_moving_sale", "declutter_my_offers", "declutter_my_order_talks",
  "declutter_my_paid_cents", "declutter_my_porch_days", "declutter_my_porch_places", "declutter_my_question_ids",
  "declutter_my_refund_todos", "declutter_my_refunded_cents", "declutter_my_reply_listings", "declutter_my_return_label",
  "declutter_my_seller_delivery", "declutter_my_trade_buyer_names", "declutter_my_setup_fee", "declutter_my_ship_label", "declutter_my_ship_tracking", "declutter_my_wanted",
  "declutter_no_helpr_choice", "declutter_order_pickup_windows", "declutter_order_place", "declutter_order_problem",
  "declutter_order_talk_view", "declutter_porch_days", "declutter_price_hint", "declutter_refund_request_view",
  "declutter_seller_can_ship", "declutter_ship_options_state", "declutter_seller_delivery_booking", "declutter_seller_delivery_offer",
  "declutter_seller_item_private", "declutter_seller_moving_sale", "declutter_seller_on_time_handovers", "declutter_seller_pickup_count", "declutter_seller_porch_places",
  "declutter_seller_sold_count", "declutter_setup_helpr", "declutter_sold_item_card", "declutter_visible_reviews", "declutter_wanted_browse",
  "get_public_profile_stats", "get_safe_profiles", "get_user_last_active", "helpr_my_route", "helpr_my_tasks", "helpr_route_suggestions",
  "helpr_task_no_show_report", "helpr_task_pickup_windows", "helpr_task_same_pickup_slot", "helpr_task_talk_view",
  "helpr_task_view", "helpr_tasks_open_count", "helpr_tasks_open_near",
]);

/**
 * Audit 1102c P7 (Q2625): the note for a request answered without being sent. A read the sample does not answer is
 * "not loaded" ("Preview: this would checkout porch days" called a read a write, in broken grammar); only a write
 * or action says what it would have done.
 */
export function previewBlockedWords(what: string, kind: "write" | "read"): string {
  return kind === "read" ? `Preview: not loaded (${what}).` : `Preview: this would ${what}.`;
}
