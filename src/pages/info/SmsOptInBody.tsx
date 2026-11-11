import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { SMS_CONSENT_TEXT_BEFORE_LINKS } from "@/lib/smsConsent";

/** F417 (audit 11-10): the one action on this page; signed-out readers log in and land on the Text alerts box. */
export const SMS_OPT_IN_ACTION_HREF = `/login?redirect=${encodeURIComponent("/profile?tab=notifications")}`;

export const SMS_OPT_IN_TITLE = "How to opt in to Louisiana Helpr text alerts";

/**
 * The body of /sms-opt-in (owner, 2026-10-23, for Twilio's A2P review): the real opt-in box, then the same box
 * ticked, the consent sentence quoted from the constant the box itself renders (src/lib/smsConsent.ts), and links to
 * the full Terms and Privacy Policy. Used by the page (SmsOptIn.tsx) AND by the build-time prerender
 * (src/prerender/staticPages.tsx), so a reader with no JavaScript gets the same text and both images. No page chrome
 * here for that reason. The two PNGs are real screenshots (WebKit 390, the sms_alerts switch shown on, nothing
 * saved), served from public/.
 */
export function SmsOptInBody() {
  return (
    <div className="page-measure mx-auto space-y-section font-sans text-ds-15 leading-relaxed text-foreground">
      {/* F417 (audit 11-10): the page opened on a wall of compliance text with nothing to do. Three short steps and
          the one button come first; every sentence Twilio's review reads is still below, unchanged. */}
      {/* F250 (audit 11-10): the one-line answer first; a first-timer could not tell from the compliance wording
          whether alerts were on, required, or where the switch lives. */}
      <p className="font-semibold" data-sms-opt-in-lead="">
        Text alerts are optional. Turn them on in Profile, Notifications, Text alerts.
      </p>
      <section className="space-y-3" aria-labelledby="sms-opt-in-steps">
        <h2 id="sms-opt-in-steps" className="font-display text-ds-20 font-semibold">Three steps</h2>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Log in, then open Profile, Notifications, Text alerts.</li>
          <li>Type your mobile number and tick the consent box.</li>
          <li>Tap Turn on text alerts and reply YES with the 4-digit code we text you.</li>
        </ol>
        <Button asChild size="wrap" className="rounded-full">
          <Link to={SMS_OPT_IN_ACTION_HREF}>Turn on text alerts</Link>
        </Button>
      </section>
      <section className="space-y-3" aria-labelledby="sms-opt-in-how">
        <h2 id="sms-opt-in-how" className="font-display text-ds-20 font-semibold">How the opt-in works</h2>
        <p>
          Signed-in members turn on text alerts in Profile, Notifications, Text alerts: they type their mobile number and
          tick the consent box, which is never pre-checked and is not a condition of using Louisiana Helpr.
        </p>
        <img
          loading="lazy"
          src="/sms-opt-in-form.png"
          alt="The Text alerts box: a mobile number field, an unchecked consent box with the message terms, and the Turn on text alerts button."
          width={700}
          height={710}
          decoding="async"
          className="w-full max-w-xl h-auto rounded-2xl border border-border"
        />
        <p>
          The box reads: <q data-sms-consent-text="">{SMS_CONSENT_TEXT_BEFORE_LINKS} Terms and Privacy Policy.</q>
        </p>
      </section>
      <section className="space-y-3">
        <p>
          Once the member ticks the box and taps Turn on text alerts, Louisiana Helpr sends one confirmation text; alerts
          start only after the member replies YES with the 4-digit code in that text (for example, YES 1234). Reply
          STOP to cancel or HELP for help.
        </p>
        <img
          loading="lazy"
          src="/sms-opt-in-confirmed.png"
          alt="The same Text alerts box with a number typed and the consent box ticked, the Turn on text alerts button enabled."
          width={700}
          height={710}
          decoding="async"
          className="w-full max-w-xl h-auto rounded-2xl border border-border"
        />
      </section>
      <p>
        Read the <Link to="/terms/full" className="underline">Terms of Service</Link> (SMS Terms) and the{" "}
        <Link to="/privacy/full" className="underline">Privacy Policy</Link> (Text messages).
      </p>
    </div>
  );
}
