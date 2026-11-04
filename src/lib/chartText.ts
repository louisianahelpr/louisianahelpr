/**
 * Q2027 (lead decision 11-04, scale 11 / 13 / 16 / 20 / 28): the text sizes recharts draws.
 * Axis ticks and legends take a number or a style object, never a className, so the two chart sizes live here,
 * on the scale, and every chart reads them. Guard: src/test/typeAndIconScaleRatchet.test.ts (both are on the scale).
 */
/** Axis ticks and legend labels: the scale's smallest size. */
export const CHART_TICK_PX = 11;
/** Tooltip body text. */
export const CHART_TOOLTIP_PX = 13;
