import { acquireBrowserLock } from "./browserLock";
import { LOCAL_BASE_URL } from "./localBase";
import { assertPreviewIsThisCheckout } from "./previewBuildCheck";

export default async function globalSetup() {
  // Q845: a reused local preview of another commit would test old code against
  // prod. Checked BEFORE the lock, so a refusal leaves no lock behind.
  await assertPreviewIsThisCheckout(LOCAL_BASE_URL);
  await acquireBrowserLock();
}
