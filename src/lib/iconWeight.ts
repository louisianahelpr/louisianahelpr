/**
 * Q2027 (owner D10; owner picked option B 2026-11-04): ONE icon weight, measured on screen.
 *
 * Every lucide icon draws its lines at ICON_STROKE_PX CSS pixels whatever its size. The app sizes icons
 * with classes (w-4 h-4, h-10 w-10), never the size prop, so lucide's absoluteStrokeWidth (which reads the
 * size prop) cannot do this; vector-effect: non-scaling-stroke (lucide's nonScalingStroke) can. Before
 * this, 6 literal weights plus the nav ternaries drew lines from about 1.2px (a 16px icon at 1.75) to 2.5px
 * (a 40px icon at 1.5). Set once in App.tsx through LucideProvider; an icon names no strokeWidth of its own.
 * Guard: src/test/typeAndIconScaleRatchet.test.ts. Gallery: ~/.lh-shots/b1-q2027w/built-*.png.
 */
export const ICON_STROKE_PX = 1.75;
