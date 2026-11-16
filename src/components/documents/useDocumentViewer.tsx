import { useCallback, useState, type ReactNode } from "react";
import { DocumentViewer, type OpenDocument } from "@/components/documents/DocumentViewer";

/** Shown when a private document could not be signed. */
export const DOCUMENT_SIGN_FAILED = "Couldn't open that document. Try again.";

/**
 * Open a document INSIDE the app (owner 2026-11-15: "add the PDF viewer too"), the document twin of
 * useSinglePhotoViewer. `show(url, name)` opens a URL already in hand; `showSigned(sign, name, onFail)` signs first and
 * opens the result, or calls `onFail` with DOCUMENT_SIGN_FAILED. Render `viewer` once in the component.
 * Guard: src/test/documentsOpenInApp.test.tsx.
 */
export function useDocumentViewer(): {
  show: (url: string, name?: string | null) => void;
  showSigned: (sign: () => Promise<string | null>, name: string | null | undefined, onFail: (msg: string) => void) => Promise<void>;
  viewer: ReactNode;
} {
  const [doc, setDoc] = useState<OpenDocument | null>(null);
  const show = useCallback((url: string, name?: string | null) => setDoc({ url, name }), []);
  const showSigned = useCallback(async (sign: () => Promise<string | null>, name: string | null | undefined, onFail: (msg: string) => void) => {
    let url: string | null;
    try {
      url = await sign();
    } catch {
      // Treated exactly like a null URL: the caller's onFail tells the user, nothing is swallowed silently.
      url = null;
    }
    if (url) setDoc({ url, name });
    else onFail(DOCUMENT_SIGN_FAILED);
  }, []);
  const close = useCallback(() => setDoc(null), []);
  return { show, showSigned, viewer: <DocumentViewer doc={doc} onClose={close} /> };
}
