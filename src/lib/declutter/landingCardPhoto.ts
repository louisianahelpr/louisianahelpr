/**
 * D017 (landing design audit 11-10): the landing's Declutter cards are 4:5 and up to ~273x341 CSS px at 1440, so the
 * 480 square Browse thumbnail came out soft there. The landing asks for 640x800 (4:5, cover); Browse keeps its square.
 * Its own module (no Supabase import), so the landing's card chunk can read the size without the Declutter api.
 */
export const LANDING_CARD_PHOTO = { width: 640, height: 800 } as const;
