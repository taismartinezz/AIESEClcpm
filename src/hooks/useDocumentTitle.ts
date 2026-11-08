"use client";

import { useEffect } from "react";

/**
 * Keep the browser tab's title. Next.js streams the layout's metadata title in
 * after the page renders, so a title set once can be overwritten a moment
 * later; this sets it again whenever the <head> changes.
 */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    const apply = () => { if (document.title !== title) document.title = title; };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [title]);
}
