import { useEffect } from "react";

/**
 * Sets the document title for SEO. Resets to "Helpr" on unmount.
 */
export const usePageTitle = (title: string) => {
  useEffect(() => {
    document.title = title;
    return () => { document.title = "Helpr"; };
  }, [title]);
};
