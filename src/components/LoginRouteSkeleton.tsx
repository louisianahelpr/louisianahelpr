import { Skeleton } from "@/components/ui/skeleton";

/**
 * Suspense fallback for the `/login` route's lazy chunk.
 *
 * Same defect as DashboardRouteSkeleton documents: on a cold 375x812 slow-3G
 * load `/login` painted the generic `RouteSuspenseFallback` (an unaligned
 * bones column on a bare page) for seconds, then swapped to a completely
 * different surface — AuthShell's centred column with the `[back] [Log In]`
 * row above a `liquid-glass` card. Two unrelated frames before the form.
 *
 * This paints Login's ACTUAL frame instead: the same page ground, the same
 * column geometry, and the same card with its head (H mark, "Log in", welcome
 * line). Only the bones inside the card change at the handoff.
 *
 * ── Why this mirrors AuthShell rather than importing it ───────────────────
 * A route Suspense fallback has to be SYNCHRONOUS, so anything it imports
 * lands in App.tsx's entry chunk — the very chunk whose download this whole
 * fix is about. `AuthShell` statically imports `Navbar` and `Footer` (and
 * through Navbar, `DesktopSidebarNav`, which App.tsx deliberately keeps
 * `lazy()`), and Login renders it with `noWebChrome`, so none of that weight
 * would ever be drawn — it would only be paid for. GuestBrowseSkeleton makes
 * the same call for the same reason ("deliberately self-contained … so it
 * stays in the eager bundle and renders instantly").
 *
 * The classes below are copied verbatim from the branch AuthShell takes for
 * Login's exact props — `hideHeader hideBack centerColumn maxWidth="sm" noWebChrome`
 * (board 37) — i.e. `centered` + `anchor="top"`, max-w-sm, no title row, no
 * compact bar, no full header, no brand pane. If AuthShell's column geometry or
 * Login's card head changes, change it here too (src/test/loginSkeletonMatchesLogin.test.ts).
 *
 * `/login` IS in DOCUMENT_SCROLL_ROUTES (AuthShell is a `min-h-screen`
 * document-scroll page, not an AppShell one), and this fallback is
 * document-scroll for the same reason — the two still agree.
 *
 * The `<h1>` is real text, not a bone: it is the word the user is waiting to
 * read, it is what the loaded page shows in the same place, and it keeps the
 * "exactly one h1" invariant true during the load instead of only after it.
 */
const LoginRouteSkeleton = () => (
  <div
    role="status"
    aria-live="polite"
    aria-busy="true"
    className="min-h-screen bg-premium-page relative overflow-hidden"
    data-testid="login-route-skeleton"
  >
    {/* AuthShell's ambient desktop wash — rendered whenever `centerColumn`
        is set, which Login sets. Hidden below lg, exactly as there. */}
    <div
      aria-hidden
      className="hidden lg:block pointer-events-none absolute inset-0 z-0"
      style={{
        background: [
          "radial-gradient(60% 55% at 12% 22%, hsl(var(--olivewood) / 0.09) 0%, transparent 60%)",
          "radial-gradient(50% 45% at 88% 78%, hsl(var(--burnt-sienna) / 0.08) 0%, transparent 60%)",
          "radial-gradient(38% 32% at 92% 18%, hsl(var(--olivewood) / 0.05) 0%, transparent 65%)",
        ].join(", "),
      }}
    />
    <div className="relative z-10 flex flex-col items-center justify-start min-h-screen px-5 sm:px-8 lg:px-12 pb-10 sm:pb-8 lg:pb-6 pt-[calc(var(--safe-area-top,0px)_+_var(--shell-gap))] sm:pt-8 lg:pt-6">
      {/* Q2249: Login's board 37 column (AuthShell maxWidth="sm" -> max-w-sm, no title row above the card). */}
      <div className="w-full max-w-sm" data-login-skeleton-column="">
        {/* The liquid-glass card Login renders, at its padding (p-5 sm:p-6 lg:p-8), opening with the same head: the
            H mark (a bone at HelprMark lg emblem's h-14), the real "Log in" h1 and the welcome line, then bones at
            the height of the email + password + submit stack. */}
        <div className="liquid-glass p-5 sm:p-6 lg:p-8 space-y-6" data-login-skeleton-card="">
          <div className="flex flex-col items-center text-center gap-1.5">
            <div className="mb-2" aria-hidden>
              <Skeleton className="h-14 w-14 rounded-2xl" />
            </div>
            <h1 className="text-page-title text-foreground">Log in</h1>
            <Skeleton className="h-4 w-44 rounded" aria-hidden />
          </div>
          <div className="space-y-3.5" aria-hidden>
            <div className="space-y-2">
              <Skeleton className="h-3.5 w-20 rounded" />
              <Skeleton className="h-12 w-full rounded-2xl" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-3.5 w-24 rounded" />
              <Skeleton className="h-12 w-full rounded-2xl" />
            </div>
            <Skeleton className="h-12 w-full rounded-full" />
          </div>
          <Skeleton className="h-3.5 w-40 mx-auto rounded" aria-hidden />
        </div>
      </div>
    </div>
    <span className="sr-only">Loading the sign-in form…</span>
  </div>
);

export default LoginRouteSkeleton;
