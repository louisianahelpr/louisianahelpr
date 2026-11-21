/**
 * The Gift of the Day's share, loaded apart from the landing (GiftCountdown.tsx, speed 11-20). A static import of
 * src/lib/nativeShare put its chunk (signed-in-shared, whose static imports are signed-in code) on every gift guide's
 * first load; a dynamic import of nativeShare itself made that chunk export its whole namespace, on /home's path too.
 * This one-line module imports only the name signed-in-shared already exports.
 */
export { shareNative } from "@/lib/nativeShare";
