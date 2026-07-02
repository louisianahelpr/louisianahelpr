// ReviewPanel — reviews / ratings surface.
//
// The implementation was split into a co-located `reviewPanel/` subdirectory
// (ReviewForm, ReviewList, StarRow, MiniStars, shared types) to keep each unit
// under the file-size budget. This module preserves the original public API so
// no importer changes: `ReviewForm` and `ReviewList` remain named exports of
// `@/components/ReviewPanel`.
export { ReviewForm } from "./reviewPanel/ReviewForm";
export { ReviewList } from "./reviewPanel/ReviewList";
