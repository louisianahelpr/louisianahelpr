import { BadgeCheck, Briefcase, Sofa, Wrench } from "lucide-react";

/**
 * The hero's phone: an HTML/CSS product illustration, not an image (no new
 * heavy asset on the landing). Every row is a generic example inside the frame,
 * never a real member, a real listing or a person's name (owner: "leave Marie
 * off the phone"; the board: "Good morning"). Decorative: aria-hidden, so a
 * screen reader never reads sample prices as real offers.
 */
const ROWS = [
  { icon: Wrench, title: "Pressure wash driveway", meta: "Abbeville · Sat · 9:00 AM", price: "$90" },
  { icon: Sofa, title: "Oak rocking chair", meta: "Broussard · porch pickup", price: "$38" },
  { icon: Briefcase, title: "Gutter cleaning", meta: "New Iberia · this week", price: "$75" },
] as const;

const PhoneMock = () => (
  <div aria-hidden className="landing-phone-wrap relative mx-auto w-full max-w-[19rem] sm:max-w-[20rem] lg:max-w-[21rem] select-none">
    <div className="landing-phone relative rounded-[2.75rem] p-2.5">
      <div className="landing-phone-screen rounded-[2.25rem] px-4 pt-6 pb-20 flex flex-col gap-3 overflow-hidden">
        <p className="landing-serif-text text-ds-20 leading-tight whitespace-nowrap" style={{ color: "var(--lp-ink)" }}>
          Good morning
        </p>
        <div className="flex gap-1.5 text-ds-11 font-semibold">
          {["Jobs", "Declutter", "Shops", "Homes"].map((t, i) => (
            <span
              key={t}
              className="rounded-full px-2.5 py-1"
              style={
                i === 0
                  ? { background: "var(--lp-action)", color: "var(--lp-on-action)" }
                  : { background: "var(--lp-surface)", color: "var(--lp-ink)" }
              }
            >
              {t}
            </span>
          ))}
        </div>
        <div className="rounded-2xl overflow-hidden" style={{ background: "var(--lp-surface)" }}>
          <div className="landing-phone-photo h-24 flex items-center justify-center">
            <Wrench className="w-7 h-7" strokeWidth={1.5} style={{ color: "var(--lp-action)" }} />
          </div>
          <div className="p-3 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-ds-13 font-bold leading-snug truncate" style={{ color: "var(--lp-ink)" }}>{ROWS[0].title}</p>
              <p className="text-ds-11" style={{ color: "var(--lp-muted)" }}>{ROWS[0].meta}</p>
            </div>
            <span className="landing-money-chip shrink-0">{ROWS[0].price}</span>
          </div>
        </div>
        {ROWS.slice(1).map(({ icon: Icon, title, meta, price }) => (
          <div key={title} className="rounded-2xl p-2.5 flex items-center gap-3" style={{ background: "var(--lp-surface)" }}>
            <span className="landing-phone-thumb w-11 h-11 rounded-xl flex items-center justify-center shrink-0">
              <Icon className="w-5 h-5" strokeWidth={1.5} style={{ color: "var(--lp-action)" }} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-ds-13 font-bold leading-snug truncate" style={{ color: "var(--lp-ink)" }}>{title}</p>
              <p className="text-ds-11 truncate" style={{ color: "var(--lp-muted)" }}>{meta}</p>
            </div>
            <span className="shrink-0 text-ds-14 font-bold" style={{ color: "var(--lp-money)" }}>{price}</span>
          </div>
        ))}
      </div>
    </div>
    {/* Floating callouts, kept inside the wrap's width so nothing overflows at 320. */}
    <div className="landing-callout absolute left-0 top-[6.25rem] -translate-x-[6%] rounded-xl px-3 py-2 text-ds-11 leading-tight">
      <p className="font-bold" style={{ color: "var(--lp-ink)" }}>Payment held</p>
      <p className="font-semibold" style={{ color: "var(--lp-money)" }}>Released when it&rsquo;s done</p>
    </div>
    <div className="landing-callout absolute right-0 bottom-7 translate-x-[4%] rounded-full pl-1.5 pr-3 py-1.5 flex items-center gap-1.5 text-ds-11 font-bold" style={{ color: "var(--lp-ink)" }}>
      <BadgeCheck className="w-5 h-5" strokeWidth={1.75} style={{ color: "var(--lp-action-strong)" }} />
      Verified neighbor
    </div>
  </div>
);

export default PhoneMock;
