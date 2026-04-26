import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { Apple, ArrowRight } from "lucide-react";

const APP_STORE_URL = "https://apps.apple.com/us/app/helpr/id6754470134";

const CTASection = () => {
  const navigate = useNavigate();

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
            className="mx-auto mt-6 inline-flex min-h-12 items-center justify-center gap-3 rounded-xl bg-primary-foreground px-5 py-3 text-primary shadow-md transition-colors hover:bg-primary-foreground/90"
            aria-label="Download Helpr on the App Store"
          >
            <Apple className="h-6 w-6" strokeWidth={1.5} />
            <span className="text-left leading-tight">
              <span className="block text-[10px] uppercase tracking-wider opacity-70">Download on the</span>
              <span className="block text-base font-semibold">App Store</span>
            </span>
          </a>
        </div>
      </div>
    </section>
  );
};

export default CTASection;
