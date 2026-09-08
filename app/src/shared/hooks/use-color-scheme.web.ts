import { useSyncExternalStore } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

// Never changes after hydration, so there is nothing to subscribe to.
const subscribe = () => () => {};
const onClient = () => true;
const onServer = () => false;

/**
 * To support static rendering, this value needs to be re-calculated on the
 * client side for web.
 *
 * The hydration flag comes from useSyncExternalStore rather than a
 * setState-in-effect: React reads the server snapshot during the static render
 * and the client snapshot after hydrating, which is the same two-pass result
 * without a second render pass to schedule.
 */
export function useColorScheme() {
  const hasHydrated = useSyncExternalStore(subscribe, onClient, onServer);
  const colorScheme = useRNColorScheme();
  return hasHydrated ? colorScheme : 'light';
}
