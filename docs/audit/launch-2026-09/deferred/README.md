# Deferred work — written, reviewed, deliberately not shipped

## `Overlay.tsx.deferred` — the shared full-screen overlay primitive

**Status: written and sound, NOT wired to anything, removed from `src/`.**

Two lanes independently flagged `src/components/ui/Overlay.tsx` sitting
UNTRACKED in the shared working tree and warned that someone was about to
collide with it in orchestrator-only territory. They were right, and it was
mine. Rather than leave an orphan in a tree that gets reset, it is parked here
with the reasoning intact.

### Why it was written

Nine hand-rolled `fixed inset-0` overlays exist, and they had arrived at
different answers to the same question. Three portalled to `document.body`,
three did not — and the three that did not were correct only because of where
they happened to be mounted. That correctness lived in a comment, not in the
code: move one of them inside `AppPage` and it breaks silently while looking
perfect.

The trap it closes is real and has been measured in this app more than once:
`position: fixed` is NOT viewport-relative if any ancestor carries a
`transform`, `filter`, `backdrop-filter`, `perspective`, `contain` or
`will-change` — and this codebase has two app-wide sources of exactly that
(`AppPage`'s `animate-ds-page-in` keyframe ends on a non-`none` transform with
`fill-mode: forwards`, and every frosted surface carries `backdrop-filter`).
Recorded consequences: a "full-screen" dialog at 329×433 in a 393×852 viewport;
a photo lightbox at 10.2% of viewport height; a nav scrim at 6.6%, so tapping
anywhere above the dock did nothing. Every one stayed perfectly scrollable,
which is why `overflow-y-auto` "fixes" nothing and a code read cannot see it.

### Why it is NOT shipped

1. **Unused files fail CI.** `knip` fails the build on an unused file, so
   committing it unwired would redden `main` for a component nobody imports.
2. **Three of nine call sites were converted, then lost.** The conversion was
   done in a worktree that was later discarded; the remaining five —
   `AppLockGate`, `ForceUpdateGate`, `MessageAttachment`, `ApplicantsPanel`,
   `PhotoLightbox` — are the ones `lh-state-matrix` has since SOURCE-verified as
   already portalling correctly, so the urgency is lower than when this started.
3. **Finishing it mid-audit invites collisions.** `src/components/ui/*` is
   orchestrator-only precisely so lanes are not editing it concurrently, and
   several lanes are actively working right now.

### What is still true, and worth doing later

The five remaining hand-rolled overlays are correct **by position, not by
construction**. `lh-a11y-sensory` has already found one live consequence of that
in this very audit: `MessageAttachment`'s lightbox was missing the `aria-hidden`
self-heal that its structural twin `PhotoLightbox` already had — half of a fix
had been ported and half had not, which is exactly the failure mode a shared
component prevents. That is the argument for finishing this, and it is a
stronger argument than when the file was written.

`OVERLAY_LAYERS` (menu 40 / panel 50 / transient 50 / lightbox 60 / lock 100 /
update 110 / celebration 120) is the other half of the value: those numbers
currently live in comments across six files, and two lightboxes independently
picked `z-[60]` without either file knowing the other existed.
