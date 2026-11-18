/**
 * Area 11 H2 (11-18): the job page's side card went blank-but-drawn on the poster's Cancelled, No-show and Late
 * cancel stages at phone width: its one button ("Post this job again") is in the phone's sticky bar (portaled to
 * <body>), and what stayed in the card were hidden step controls (`<div hidden data-poster-more>`) and empty hosts,
 * so `empty:hidden` never matched and a 32 px white card sat under the status line.
 *
 * The card now hides when every direct child is `[hidden]` or `:empty`: no visible child, no card.
 */
export const BLANK_CARD_SELECTOR = ":not(:has(>:not([hidden]):not(:empty)))";
/** The Tailwind class for BLANK_CARD_SELECTOR (spelled out so the content scan sees it). */
export const HIDE_WHEN_BLANK = "[&:not(:has(>:not([hidden]):not(:empty)))]:hidden";
