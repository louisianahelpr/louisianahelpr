import { acquireBrowserLock } from "./browserLock";
export default async function globalSetup() {
  await acquireBrowserLock();
}
