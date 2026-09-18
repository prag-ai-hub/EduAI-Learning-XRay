/**
 * The in-app light/dark override, readable by every style in the app.
 *
 * `useThemePreference` owns the user's choice and persists it; this module is
 * how that choice reaches `useAppStyles`. Without it the workspace's appearance
 * toggle changed its own glyph and nothing else, because every style resolves
 * its scheme through `useColorScheme`, which only ever read the device.
 *
 * Why not `Appearance.setColorScheme`: React Native implements it and
 * react-native-web does not, so the toggle would have worked on a phone and
 * silently done nothing in the browser - where the web app's toggle had always
 * worked, by writing `data-theme` onto the root element.
 *
 * A module-level store rather than a context provider, because the consumer is
 * `useColorScheme`, a hook called from inside `useAppStyles` by hundreds of
 * components. A provider would have to wrap the whole route tree for a value
 * that changes about once a session. `useSyncExternalStore` is the React
 * primitive for exactly this: one source, every reader re-renders together, and
 * the server snapshot keeps a static render on the device default.
 */

import { useSyncExternalStore } from 'react';

/** `null` defers to the device. */
export type SchemeOverride = 'light' | 'dark' | null;

let current: SchemeOverride = null;
const listeners = new Set<() => void>();

export function setSchemeOverride(next: SchemeOverride): void {
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const read = (): SchemeOverride => current;
const readOnServer = (): SchemeOverride => null;

export function useSchemeOverride(): SchemeOverride {
  return useSyncExternalStore(subscribe, read, readOnServer);
}
