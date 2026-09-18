/**
 * The saved light/dark choice, and the setter that changes it.
 *
 * The web app had this: `.theme-toggle` wrote `data-theme` onto the root and
 * mirrored it into localStorage under `eduai-theme`
 * (FunctionalEduAIApp.tsx:319,326). `StorageKeys.theme` was carried across with
 * the rest of the storage map and then had no owner - `useTheme` reads the
 * OS scheme and nothing wrote a preference at all, so the toggle would have
 * been a control that forgot its own state on every launch.
 *
 * `useColorScheme()` is the device setting and stays the default. This is the
 * in-app override on top of it: 'system' defers, 'light' and 'dark' do not.
 */

import { useCallback, useEffect, useState } from 'react';

import { setSchemeOverride } from '@/shared/hooks/scheme-override';
import { useDeviceColorScheme } from '@/shared/hooks/use-color-scheme';
import { StorageKeys, appStore } from '@/shared/storage';

export type ThemeChoice = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark'];

export type ThemePreference = {
  /** What the user chose. 'system' until they choose otherwise. */
  choice: ThemeChoice;
  /** What to actually render - the choice, or the device's scheme under it. */
  theme: ResolvedTheme;
  setChoice: (next: ThemeChoice) => void;
  /** True once the stored value has been read, so a toggle does not flash. */
  ready: boolean;
};

export function useThemePreference(): ThemePreference {
  // The device, not `useColorScheme`: that one already returns the override,
  // so 'system' would resolve to whatever was last chosen instead of the OS.
  const scheme = useDeviceColorScheme();
  const device: ResolvedTheme = scheme === 'dark' ? 'dark' : 'light';
  const [choice, setStoredChoice] = useState<ThemeChoice>('system');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      // A missing or corrupted value is 'system', which is also the default -
      // a preference nobody can read is a preference nobody set. `getJson`
      // already returns the fallback for a torn write, so the catch is only
      // for the store itself being unavailable.
      const saved = await appStore
        .getJson<ThemeChoice | null>(StorageKeys.theme, null)
        .catch(() => null);
      if (!alive) return;
      if (saved !== null && CHOICES.includes(saved)) {
        setStoredChoice(saved);
        setSchemeOverride(saved === 'system' ? null : saved);
      }
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const setChoice = useCallback((next: ThemeChoice) => {
    // Applied immediately, persisted behind it: a toggle that waits for a disk
    // write before moving feels broken, and the write cannot fail in a way the
    // user could act on.
    setStoredChoice(next);
    setSchemeOverride(next === 'system' ? null : next);
    void appStore.setJson(StorageKeys.theme, next).catch(() => {});
  }, []);

  return { choice, theme: choice === 'system' ? device : choice, setChoice, ready };
}
