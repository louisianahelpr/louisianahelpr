import { Apple, Facebook } from "lucide-react";

const APP_STORE_URL = "https://apps.apple.com/us/app/helpr/id6754470134";
const FACEBOOK_URL = "https://www.facebook.com/profile.php?id=61575800761358";

const CTASection = () => {

  return (
    <section className="py-20 px-4">
      <div className="container mx-auto max-w-4xl">
        <div className="rounded-2xl bg-primary px-5 py-10 text-center sm:px-10 sm:py-14">
          <h2 className="mx-auto max-w-2xl text-3xl font-display font-bold text-primary-foreground sm:text-4xl">
            Ready to get help or start earning?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-primary-foreground/80 sm:text-base">
            Join Louisiana neighbors posting local tasks, finding trusted helprs, and getting work done.
          </p>

          <a
            href={APP_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="group mx-auto mt-8 inline-flex min-h-14 items-center justify-center gap-3 rounded-2xl bg-foreground px-7 py-3.5 text-background shadow-[0_10px_30px_-10px_hsl(var(--foreground)/0.5)] ring-1 ring-foreground/10 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-12px_hsl(var(--foreground)/0.6)]"
            aria-label="Download Helpr on the App Store"
          >
            <Apple className="h-7 w-7 transition-transform duration-300 group-hover:scale-110" strokeWidth={1.5} fill="currentColor" />
            <span className="text-left leading-tight">
              <span className="block text-[10px] font-medium uppercase tracking-[0.18em] opacity-70">Download on the</span>
              <span className="block text-lg font-semibold tracking-tight">App Store</span>
            </span>
          </a>
        </div>
      </div>
    </section>
  );
};

export default CTASection;
