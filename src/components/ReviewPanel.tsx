// ReviewPanel — reviews / ratings surface.
//
// The implementation was split into a co-located `reviewPanel/` subdirectory
// (ReviewForm, StarRow, MiniStars, shared types) to keep each unit under the
// file-size budget. This module preserves the original public API so no
// importer changes: `ReviewForm` remains a named export of
// `@/components/ReviewPanel`. (ReviewList, mounted nowhere, was deleted 11-15.)
export { ReviewForm } from "./reviewPanel/ReviewForm";
