"use client";
import { useEffect } from "react";

// Multiple batch drafts share one warning instead of opening one dialog per card.
const pending = new Set<object>();
const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
const navigate = (event: MouseEvent) => {
  if (!(event.target instanceof Element) || !event.target.closest("nav button, a[href]")) return;
  if (!confirm("Leave this page? Unsaved payment readings will be discarded and any reading in progress will stop.")) { event.preventDefault(); event.stopPropagation(); }
};
export function useReceiptNavigationGuard(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const token = {};
    if (!pending.size) { window.addEventListener("beforeunload", warn); document.addEventListener("click", navigate, true); }
    pending.add(token);
    return () => {
      pending.delete(token);
      if (!pending.size) { window.removeEventListener("beforeunload", warn); document.removeEventListener("click", navigate, true); }
    };
  }, [enabled]);
}
