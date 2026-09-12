import { releaseBrowserLock } from "./browserLock";
export default async function globalTeardown() {
  releaseBrowserLock();
}
