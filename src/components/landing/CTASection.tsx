import { Apple, Facebook, Sparkles } from "lucide-react";

const APP_STORE_URL = "https://apps.apple.com/us/app/helpr/id6754470134";
const FACEBOOK_URL = "https://www.facebook.com/profile.php?id=61575800761358";

const CTASection = () => {
  return (
    <section className="px-4 py-20">
      <div className="container mx-auto max-w-5xl">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary via-primary to-primary/85 px-5 py-14 text-center shadow-[0_30px_80px_-30px_hsl(var(--primary)/0.6)] sm:px-12 sm:py-20">
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

            <h2 className="mx-auto mt-5 max-w-2xl text-3xl font-display font-bold leading-tight text-primary-foreground sm:text-5xl">
              Ready to get help or start earning?
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-primary-foreground/80 sm:text-base">
              Join Louisiana neighbors posting local tasks, finding trusted helprs, and getting work done — all from your phone.
            </p>

            {/* Action buttons */}
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
              <a
                href={APP_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative inline-flex min-h-14 w-full items-center justify-center gap-3 overflow-hidden rounded-2xl bg-gradient-to-b from-foreground to-foreground/85 px-7 py-3.5 text-background shadow-[0_14px_36px_-10px_hsl(var(--foreground)/0.7),inset_0_1px_0_0_hsl(var(--background)/0.18)] ring-1 ring-foreground/20 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[0_24px_50px_-12px_hsl(var(--foreground)/0.8),inset_0_1px_0_0_hsl(var(--background)/0.25)] sm:w-auto"
                aria-label="Download Helpr on the App Store"
              >
                {/* Glossy top highlight */}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-2xl bg-gradient-to-b from-background/15 to-transparent"
                />
                {/* Shimmer sweep on hover */}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-background/20 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full"
                />
                <Apple className="relative h-7 w-7 drop-shadow-[0_1px_2px_hsl(var(--background)/0.3)] transition-transform duration-300 group-hover:scale-110" strokeWidth={1.5} fill="currentColor" />
                <span className="relative text-left leading-tight">
                  <span className="block text-[10px] font-medium uppercase tracking-[0.18em] opacity-70">Download on the</span>
                  <span className="block text-lg font-semibold tracking-tight">App Store</span>
                </span>
                <span
                  aria-hidden="true"
                  className="relative ml-1 hidden rounded-md bg-background/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-background ring-1 ring-background/20 sm:inline-block"
                >
                  iOS
                </span>
              </a>

              <a
                href={FACEBOOK_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl border border-primary-foreground/25 bg-primary-foreground/10 px-7 py-3.5 text-primary-foreground backdrop-blur-md transition-all duration-300 ease-out hover:-translate-y-0.5 hover:border-primary-foreground/40 hover:bg-primary-foreground/15 sm:w-auto"
                aria-label="Follow Helpr on Facebook"
              >
                <Facebook className="h-6 w-6 transition-transform duration-300 group-hover:scale-110" strokeWidth={1.75} />
                <span className="text-left leading-tight">
                  <span className="block text-[10px] font-medium uppercase tracking-[0.18em] opacity-70">Follow us on</span>
                  <span className="block text-lg font-semibold tracking-tight">Facebook</span>
                </span>
              </a>
            </div>

            {/* Trust strip */}
            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-primary-foreground/70">
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
