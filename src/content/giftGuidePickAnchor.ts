/**
 * A gift row's own #link on its guide ("gift-lego-snowman-ornaments"): the row's id (GiftGuideView.tsx PickRow) and the
 * link a search result opens (GiftGuideShare.tsx), so picking a gift in search lands ON that gift, not at the top of
 * its guide (guide audit 1123 I2; last night's P1). Built from the gift's name, which is unique inside a guide (the
 * content audit checks no name repeats in Her, Him, Kids or the sponsors page). Guard: src/test/guideAuditFixes1123.test.tsx.
 */
export const PICK_ANCHOR_PREFIX = "gift-";

export const pickAnchor = (name: string): string =>
  `${PICK_ANCHOR_PREFIX}${name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80)}`;
