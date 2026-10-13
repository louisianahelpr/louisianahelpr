/**
 * True only for a `blob:` URL, the one kind of photo preview the checkout
 * step renders. Moved out of CheckoutStep.tsx unchanged (it paid for the
 * under-18 grey-out's lines there, Q1586(c)).
 */
export const isSafeBlobPreviewUrl = (value: string): boolean => {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "blob:";
  } catch {
    // Not a parseable URL, so not a blob: preview; the answer IS the handling.
    return false;
  }
};
