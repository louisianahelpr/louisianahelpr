/**
 * Have I Been Pwned password check.
 * Uses k-anonymity: only the first 5 chars of the SHA-1 hash leave the browser.
 * https://haveibeenpwned.com/API/v3#PwnedPasswords
 */

async function sha1Hex(str: string): Promise<string> {
  const buf = new TextEncoder().encode(str);
  const hashBuf = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/**
 * Returns the number of times the password has appeared in known breaches.
 * Returns 0 if not found, or null if the check failed (network error, etc).
 * Fail-open: callers should treat null as "allow" rather than blocking.
 */
export async function checkPasswordPwned(password: string): Promise<number | null> {
  try {
    const hash = await sha1Hex(password);
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);

    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true" },
    });
    if (!res.ok) return null;

    const text = await res.text();
    for (const line of text.split("\n")) {
      const [s, count] = line.trim().split(":");
      if (s === suffix) return parseInt(count, 10) || 0;
    }
    return 0;
  } catch {
    return null;
  }
}
