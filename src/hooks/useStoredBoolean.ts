"use client";

import { useCallback, useSyncExternalStore } from "react";

const preferenceEvent = "fact-checker:preference-changed";
const fallback = new Map<string, boolean>();

/** Hydrate browser preferences without overwriting stored values during mount. */
export function useStoredBoolean(key: string, defaultValue: boolean) {
  const read = useCallback(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? defaultValue : stored === "true";
    } catch { return fallback.get(key) ?? defaultValue; }
  }, [key, defaultValue]);
  const subscribe = useCallback((notify: () => void) => {
    window.addEventListener("storage", notify);
    window.addEventListener(preferenceEvent, notify);
    return () => {
      window.removeEventListener("storage", notify);
      window.removeEventListener(preferenceEvent, notify);
    };
  }, []);
  const value = useSyncExternalStore(subscribe, read, () => defaultValue);
  const setValue = useCallback((next: boolean | ((previous: boolean) => boolean)) => {
    const nextValue = typeof next === "function" ? next(read()) : next;
    fallback.set(key, nextValue);
    try { localStorage.setItem(key, String(nextValue)); }
    catch { /* Restricted storage still permits preferences for this page. */ }
    window.dispatchEvent(new Event(preferenceEvent));
  }, [key, read]);
  return [value, setValue] as const;
}
