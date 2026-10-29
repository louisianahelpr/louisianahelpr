/**
 * What another member sees on your profile, item by item (A3-C18, owner
 * 2026-10-29: the privacy policy lists what profiles show). The policy used to
 * say "first name, profile photo, ratings and reviews"; the profile shows a
 * good deal more. Read 2026-10-29 from the two layers that decide it:
 *
 *   get_safe_profiles (newest 20261021131322_member_names_first_and_initial),
 *   the only read of another member's profile row:
 *     full_name        via display_name_for_viewer: first name + last initial
 *     avatar_url, location, bio, skills, portfolio_urls, created_at
 *     is_id_verified, is_payout_ready, is_licensed/license_status,
 *     is_insured/insurance_status, business_name (only once one is verified),
 *     subscription_tier
 *   (hourly_rate is returned but no screen shows it; role is never another
 *   member's admin flag.)
 *
 *   /user/:id (ProtectedRoute: signed-in members only), src/pages/user/:
 *     ProfileHeaderCard  name, photo, area (location), bio, skills, member
 *                        since, last-active label, business name
 *     RecognitionRow     ID verified, Payouts set up, Licensed & Insured,
 *                        Background-Checked, membership tier, job milestones
 *     AtAGlanceCard      rating + review count, Jobs completed, Jobs posted,
 *                        Worked together
 *     JobsList           each completed job: title, date, category, price
 *     ReviewsSection     reviews about you, and your public replies
 *     HelperWorkPhotos   portfolio_urls
 *     DeclutterProfileSection / SellingNowRow  items for sale, buyer reviews
 *
 * Guard: src/test/privacyListsWhatProfilesShow.test.ts.
 */
export const PROFILE_SHOWS = [
  "Your first name and the first letter of your last name",
  "Your profile photo",
  "The town or area you list",
  "What you write about yourself, your skills and any work photos you add",
  "When you joined and roughly when you were last active",
  "Your badges: ID verified, payouts set up, a verified license or insurance (with your business name), a background check, your membership and the job milestones you reach",
  "Your rating, the reviews people leave you and your replies to them",
  "How many jobs you have posted, and the jobs you have completed with each one's title, date, type of work and price",
  "How many jobs you and they have worked on together",
  "Items you list for sale, and reviews from buyers",
] as const;

/** What the profile never shows another member (none of it is in get_safe_profiles). */
export const PROFILE_NEVER_SHOWS =
  "They never see your surname, email, phone, street address, date of birth or ID documents on your profile.";
