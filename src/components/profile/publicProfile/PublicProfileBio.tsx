/**
 * The bio on /u/<handle>. On a phone (below lg, owner 11-14 Depop/Vinted review item 10) it is clamped to two lines
 * with "more" to open it, so the compact header stays short; from lg it shows in full, as before.
 */
import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export function PublicProfileBio({ bio }: { bio: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [clamped, setClamped] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setClamped(el.scrollHeight > el.clientHeight + 1);
    check();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [bio]);
  return (
    <div className="relative mt-3 text-left max-lg:mt-2">
      <p
        ref={ref}
        id="pp-bio"
        className={`whitespace-pre-line text-ds-15 text-foreground [overflow-wrap:anywhere] max-lg:text-ds-14${open ? "" : " max-lg:line-clamp-2"}`}
        data-testid="pp-bio"
      >
        {bio}
      </p>
      {/* "more" sits at the end of the second line, over a fade into the page; "less" under the open bio. min-h-0
          (size="inline") drops the 44px button floor so the line keeps its height; its ::before keeps a 44px-tall hit area (.tap-44 would
          set position: relative and undo the absolute). */}
      {clamped && !open && (
        <Button
          type="button"
          variant="ghost"
          size="inline"
          className="absolute bottom-0 right-0 text-ds-14 font-semibold tracking-normal text-foreground before:absolute before:-inset-y-3 before:inset-x-0 before:content-[''] lg:hidden"
          aria-expanded={false}
          aria-controls="pp-bio"
          data-testid="pp-bio-more"
          onClick={() => setOpen(true)}
        >
          <span className="bg-gradient-to-r from-transparent to-[hsl(var(--background))] to-[1.5rem] pl-7">more</span>
        </Button>
      )}
      {open && (
        <Button
          type="button"
          variant="ghost"
          size="inline"
          className="tap-44 text-ds-13 font-semibold tracking-normal text-foreground underline underline-offset-2 lg:hidden"
          aria-expanded
          aria-controls="pp-bio"
          data-testid="pp-bio-more"
          onClick={() => setOpen(false)}
        >
          less
        </Button>
      )}
    </div>
  );
}
