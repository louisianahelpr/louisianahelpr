# One job, start to finish — what each side sees and does

**Status: APPROVED by the owner (2026-10-08), with the four answers below.** Once approved, this file is the
contract: both job cards (My Posts and My Jobs), every status line, every button and every
server check are built from it, and one end-to-end test walks it step by step.

## Rules that apply at every step

- **Card layout, expanded, top to bottom:** title and details → description (notes, photos)
  → tracker → timer → the other person's tile → ONE row: **More** (left) + **one primary**
  (right). Nothing below the row. Collapsed: title, place/date/time, then one status line.
- **More** holds everything else, most important first: Message, Directions, photos,
  Ask for a new date or time, Edit, Share, Boost, Report a Problem / Dispute, Cancel, SOS (last).
  The menu is as wide as its contents.
- **A greyed primary always says when it turns on** ("This button turns on at 1:00 PM",
  "…once Lexi says they've arrived").
- **Status lines use the person's name** ("Lexi accepted", "Lexi is on the way").
- **The tracker only marks a step done when it truly happened.** The server refuses every
  step out of order; the buttons never offer one.
- **Timers say what they count to** ("52m until the job starts", "3h left to accept").

## Which tab a job is in (owner, 2026-10-08)

Each side's tab follows THAT side's next move:

1. Accepted → **Scheduled**.
2. The 24-hour confirm window opens and this side has not confirmed → **Needs You**.
3. This side has confirmed → back to **Scheduled**.
4. The job starts (its start time, or the Helpr heads out, whichever is first) → **Needs You**.

Before an accept and after the job: unchanged (offers, approvals and payment follow the table
below; Done and Cancelled as today).

## When someone backs out (owner, 2026-10-08: "the other person needs to be very aware so they don't show up or expect someone")

A decline of an offer, or a cancel by either side after an accept:

- the other person gets a push, an in-app notification and an email at once;
- their card moves to **Needs You** with a red banner naming who and what ("Lexi cancelled —
  they won't be coming" / "Sam cancelled this job — don't go"), and stays there until they
  tap **Got It**;
- inside 24 h of the start, the push repeats until Got It.

## The steps

| # | Step | Poster sees / does | Helpr sees / does | Server enforces |
|---|------|--------------------|-------------------|-----------------|
| 1 | **Posted** | Status "No applicants yet" (or "1 applicant · offer expired"). Primary **View Applicants** (greyed until someone applies). More: Edit, Share, Boost, Cancel. | Sees it in Browse: place, date, time always; countdown only if room. | Start ≥ 2 h after posting; listing closes at the start. |
| 2 | **Applied** | "Lexi applied". Primary **View Applicants**; the poster may message an applicant first. | Pop-up "Application sent" (not a toast). Card: "Waiting for Sam to choose". Primary greyed **Waiting on Sam**. More: Withdraw (Message only after Sam writes first). | One application per Helpr. |
| 3 | **Offered** (poster picks) | "Offer sent — Lexi hasn't accepted yet · 3h left to accept"; next line "1d 2h until the job starts". Primary greyed **Waiting on Lexi**. More: Message, Cancel. | "Sam offered you this job · 3h left to accept". Primary **Accept Job**. More: Message, Decline. | Answer window ends before the start. No answer = declined, job reopens. |
| 4 | **Accepted** | "Lexi accepted". Timer: until confirmation opens / until the job starts. Primary greyed **I'm Still On** ("turns on Wed 12:00 AM, the day before"). More: Message, Ask for a new date or time, Cancel. | "You accepted". If Stripe setup is unfinished: primary **Finish Accepting**. Else primary greyed **Confirm You'll Be at the Job** ("turns on …"). More: Message, Directions, Ask for a new date or time, Cancel Job. | Accept completes only when Stripe payouts + ID are done. |
| 5 | **Confirm window open** (midnight the day before; immediately for a job booked inside it) | Primary **I'm Still On** (live). | Primary **Confirm You'll Be at the Job** (live). | Accepting does NOT count as confirming. Each side's tap is its own stamp. |
| 6 | **Confirmed** (both tapped) | Tracker: Confirmed ✓. Primary greyed **Confirm They've Arrived** ("turns on once Lexi says they've arrived"). | Tracker: Confirmed ✓. Primary greyed **I'm On My Way** ("turns on at 1:00 PM", 2 h before). | On My Way refused until the Helpr has confirmed and it is within 2 h of the start. |
| 7 | **On the way** | "Lexi is on the way" + live map. Primary greyed **Confirm They've Arrived**. | Primary **I've Arrived** (checks they're at the address). More: Message, Directions, Report a Problem, SOS. | Arrival needs On the way first. |
| 8 | **Arrived** | "Lexi has arrived". Primary **Confirm They've Arrived** (live). | If photos required: primary **Take Before Photo**, then **Start Working**. Else **Start Working**. | Start Working needs Arrived, GPS-verified or confirmed by the poster (and the before photo when required). |
| 9 | **Working** | "Lexi is working". Primary **Confirm They're Working** — live only after Lexi taps Start Working. | Primary greyed **Mark Job Complete** until the after photo (when required): **Take After Photo**, then **Mark Job Complete**. | Poster's "working" confirm refused until the Helpr's Working. Complete needs Working (+ after photo). |
| 10 | **Marked done** | "Lexi marked it done — check the work". Timer: "Pays out automatically in 23h". Primary **Approve & Pay**. More: Request a Fix, Dispute. | "Waiting for Sam to approve · pays out in 23h". Primary greyed **Waiting on Sam**. | Release only by approve, the auto-release timer, or an admin. |
| 11 | **Done** | "Paid". Primary **Leave a Review** (then Tip). | "Paid — $X on its way" (payout in 3 days). Primary **Leave a Review**. | Reviews unlock when both are in or after 14 days. |

**Off the happy path** (each keeps the same layout): a new date/time request (shows on the
COLLAPSED card for the person asked, with Accept / Decline; needs ≥ 1 h notice; if it can't
apply, both are told why), Cancel (fees by the cancellation rules), No-show, Dispute, Request a
Fix (Helpr gets "Sam asked for a fix" and **I'll Fix It**).

## The owner's answers (2026-10-08) — part of the contract

1. **A Helpr who never confirms:** both sides can **Nudge** each other to confirm (in More,
   and on the greyed button's line), and the Helpr keeps getting reminder notifications until
   they confirm. Still unconfirmed **2 hours before the start**, the job is **reposted** to
   other Helprs.
2. **A poster who never confirms:** nothing is blocked; their card keeps asking.
3. **The poster's arrival and working confirms are optional:** offered only AFTER the Helpr's
   own step (arrival after "I've Arrived", working after "Start Working"). Refined by pop-up
   (2026-10-08, "GPS skips it"): when the Helpr's location verified the arrival, Start Working
   and Mark Job Complete never wait on the poster; when it did not (Location off, or too far),
   the poster's "Confirm They Arrived" is still what unlocks them.
4. **Messaging before a hire:** an applicant can NOT message first. Message opens once the
   poster sends an offer, or when the poster messages an applicant first.
