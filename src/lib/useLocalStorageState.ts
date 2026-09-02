"use client";

import { useCallback, useSyncExternalStore } from "react";

const listeners = new Map<string, Set<() => void>>();

function notify(key: string) {
  listeners.get(key)?.forEach((l) => l());
}

/**
 * State persisted to localStorage under `key`, kept in sync across every
 * component using the same key. The server snapshot is always `null`
 * (localStorage doesn't exist during SSR), so the first client render
 * briefly shows `initial` before the real snapshot is read.
 */
export function useLocalStorageState<T>(key: string, initial: T) {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key)!.add(onStoreChange);
      return () => listeners.get(key)!.delete(onStoreChange);
    },
    [key],
  );

  const getSnapshot = useCallback(() => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }, [key]);

  const getServerSnapshot = useCallback(() => null, []);

  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const value: T = raw !== null ? (JSON.parse(raw) as T) : initial;

  const setValue = useCallback(
    (updater: T | ((prev: T) => T)) => {
      let prevValue = initial;
      try {
        const prevRaw = window.localStorage.getItem(key);
        if (prevRaw !== null) prevValue = JSON.parse(prevRaw) as T;
      } catch {
        // fall back to initial
      }
      const nextValue = typeof updater === "function" ? (updater as (p: T) => T)(prevValue) : updater;
      try {
        window.localStorage.setItem(key, JSON.stringify(nextValue));
      } catch {
        // storage full or unavailable — nothing we can do client-side
      }
      notify(key);
    },
    [key, initial],
  );

  return [value, setValue] as const;
}
