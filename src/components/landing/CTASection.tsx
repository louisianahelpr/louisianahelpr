import { Apple, Facebook, Sparkles } from "lucide-react";

const APP_STORE_URL = "https://apps.apple.com/us/app/helpr/id6754470134";
const FACEBOOK_URL = "https://www.facebook.com/louisianahelpr";

const CTASection = () => {
  return (
    <section className="px-4 py-12">
      <div className="container mx-auto max-w-3xl">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary via-primary to-primary/85 px-4 py-10 text-center shadow-[0_20px_60px_-25px_hsl(var(--primary)/0.6)] sm:px-8 sm:py-12">
          {/* Decorative blobs */}
          <div className="pointer-events-none absolute -top-24 -left-24 h-72 w-72 rounded-full bg-accent/30 blur-3xl" aria-hidden="true" />
          <div className="pointer-events-none absolute -bottom-32 -right-20 h-80 w-80 rounded-full bg-secondary/40 blur-3xl" aria-hidden="true" />
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.07]"
            style={{
              backgroundImage:
                "radial-gradient(circle at 1px 1px, hsl(var(--primary-foreground)) 1px, transparent 0)",
              backgroundSize: "22px 22px",
            }}
            aria-hidden="true"
          />

          <div className="relative">
            {/* Eyebrow */}
            <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-primary-foreground/20 bg-primary-foreground/10 px-4 py-1.5 text-[11px] font-medium uppercase tracking-[0.2em] text-primary-foreground/90 backdrop-blur">
              <Sparkles className="h-3.5 w-3.5" />
              Built for Louisiana
            </div>

            <h2 className="mx-auto mt-4 max-w-xl text-2xl font-display font-bold leading-tight text-primary-foreground sm:text-3xl">
              Ready to get help or start earning?
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-primary-foreground/80">
              Join Louisiana neighbors posting local tasks, finding trusted helprs, and getting work done — all from your phone.
            </p>

            {/* Action buttons */}
            <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-3">
              <a
                href={APP_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex min-h-12 w-full items-center justify-center gap-2.5 rounded-xl bg-foreground px-5 py-2.5 text-background shadow-[0_8px_24px_-8px_hsl(var(--foreground)/0.6)] ring-1 ring-foreground/10 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[0_16px_36px_-10px_hsl(var(--foreground)/0.7)] sm:w-auto"
                aria-label="Download Helpr on the App Store"
              >
                <Apple className="h-5 w-5 transition-transform duration-300 group-hover:scale-110" strokeWidth={1.5} fill="currentColor" />
                <span className="text-left leading-tight">
                  <span className="block text-[9px] font-medium uppercase tracking-[0.18em] opacity-70">Download on the</span>
                  <span className="block text-sm font-semibold tracking-tight">App Store</span>
                </span>
              </a>

              <a
                href={FACEBOOK_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex min-h-12 w-full items-center justify-center gap-2.5 rounded-xl bg-[#1877F2] px-5 py-2.5 text-white shadow-[0_8px_24px_-8px_rgba(24,119,242,0.6)] ring-1 ring-white/10 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:bg-[#166FE5] hover:shadow-[0_16px_36px_-10px_rgba(24,119,242,0.7)] sm:w-auto"
                aria-label="Follow Helpr on Facebook"
              >
                <Facebook className="h-5 w-5 transition-transform duration-300 group-hover:scale-110" strokeWidth={1.5} fill="currentColor" />
                <span className="text-left leading-tight">
                  <span className="block text-[9px] font-medium uppercase tracking-[0.18em] opacity-70">Follow us on</span>
                  <span className="block text-sm font-semibold tracking-tight">Facebook</span>
                </span>
              </a>
            </div>

            {/* Trust strip */}
            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-primary-foreground/70">
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground/60" />
                Free to join
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground/60" />
                Verified helprs
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground/60" />
                Secure payments
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default CTASection;
