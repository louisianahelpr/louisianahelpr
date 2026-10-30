export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_FILE_SIZE = 5 * 1024 * 1024;

/** The dictionary key naming what is wrong with a picked photo (its type, or over 5 MB), or null when it is fine. */
export function fileProblemKey(file: File, allowedTypes: string[]): "profileGate.fileType" | "profileGate.fileSize" | null {
  if (!allowedTypes.includes(file.type)) return "profileGate.fileType";
  if (file.size > MAX_FILE_SIZE) return "profileGate.fileSize";
  return null;
}

export const withTimeout = async <T,>(promise: Promise<T>, label: string, ms = 60000): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out. Please check your connection and try again.`)), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};
