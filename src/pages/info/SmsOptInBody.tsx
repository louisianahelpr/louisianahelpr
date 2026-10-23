import { Link } from "react-router-dom";
import { SMS_CONSENT_TEXT_BEFORE_LINKS } from "@/lib/smsConsent";

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
      <section className="space-y-3">
        <p>
          Signed-in members turn on text alerts in Profile, Notifications, Text alerts: they type their mobile number and
          tick the consent box, which is never pre-checked and is not a condition of using Louisiana Helpr.
        </p>
        <img
          src="/sms-opt-in-form.png"
          alt="The Text alerts box: a mobile number field, an unchecked consent box with the message terms, and the Turn on text alerts button."
          width={700}
          height={710}
          loading="lazy"
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
          src="/sms-opt-in-confirmed.png"
          alt="The same Text alerts box with a number typed and the consent box ticked, the Turn on text alerts button enabled."
          width={700}
          height={710}
          loading="lazy"
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
