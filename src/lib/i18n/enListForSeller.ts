/**
 * The job page's "list it for the seller" panel in English (F260q): ListForSellerPanelOpen.tsx (a hired Helpr writes
 * Declutter listings on the poster's account). One panel's words, imported by that panel only, so they are inlined into
 * its lazy chunk (Q178). Spanish: esListForSeller.ts.
 */
import { addEnglish } from "./enRegistry";

export const enListForSeller = {
  "lfs.st.draft": "Not sent yet",
  "lfs.st.pending_seller_approval": "Waiting for their approval",
  "lfs.st.approved": "Approved",
  "lfs.st.declined": "Not used",
  "lfs.updated": "Listing updated.",
  "lfs.saved": "Listing saved. Send it when you're ready.",
  "lfs.saveFail": "We couldn't save that listing. Try again.",
  "lfs.editAria": "Edit {title}",
  "lfs.newAria": "New listing for {name}",
  "lfs.addPhotos": "Add photos (has {count})",
  "lfs.photos": "Photos",
  "lfs.title": "Title",
  "lfs.description": "Description",
  "lfs.category": "Category",
  "lfs.condition": "Condition",
  "lfs.size": "Size",
  "lfs.price": "Price ($)",
  "lfs.lowest": "Lowest price ($)",
  "lfs.samePrice": "Same as price",
  "lfs.area": "Neighborhood or town",
  "lfs.cancel": "Cancel",
  "lfs.saveChanges": "Save changes",
  "lfs.saveListing": "Save listing",
  "lfs.sentOne": "Sent. They'll approve it on Declutter.",
  "lfs.sentMany": "Sent {count} listings. They'll approve them on Declutter.",
  "lfs.sendFail": "We couldn't send those. Try again.",
  "lfs.deleteFail": "We couldn't delete that. Try again.",
  "lfs.theSeller": "the seller",
  "lfs.aria": "Listings for {name}",
  "lfs.intro": "Write each listing here. It goes on {name}'s account and stays off sale until {name} approves it.",
  "lfs.sendOne": "Send it to {name} for approval",
  "lfs.sendAll": "Send all {count} to {name} for approval",
  "lfs.add": "Add listing for {name}",
  "lfs.edit": "Edit",
  "lfs.delete": "Delete",
  "lfs.deleteAria": "Delete {title}",
} as const;

addEnglish(enListForSeller);
