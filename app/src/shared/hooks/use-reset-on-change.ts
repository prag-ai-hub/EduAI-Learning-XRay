import { useState } from 'react';

/**
 * The sentinel the "seen" token starts at, so the first render is always a
 * change and `reset` therefore also runs on mount. A Symbol is used rather than
 * null or undefined because both are legitimate token values - `useResetOnChange(null, ...)`
 * must still fire once.
 */
export const RESET_ON_MOUNT = Symbol('reset-on-mount');

/**
 * Apply `reset` during render when `token` changes, and once on mount.
 *
 * This is React's documented "adjusting state when a prop changes". An effect
 * whose only job is to mirror a value into state renders once with the stale
 * value and then again with the fresh one; doing it during render skips that
 * wasted pass. The semantics match `useEffect(reset,[token])` - it fires on
 * mount and on every subsequent change - so it is a drop-in for that shape of
 * effect, and only for that shape. Anything with a timer, a subscription or a
 * fetch still belongs in an effect.
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx:25.
 */
export function useResetOnChange(token: unknown, reset: () => void): void {
  const [seen, setSeen] = useState<unknown>(RESET_ON_MOUNT);
  if (!Object.is(token, seen)) {
    setSeen(token);
    reset();
  }
}
