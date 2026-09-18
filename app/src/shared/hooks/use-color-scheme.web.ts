import { useSyncExternalStore } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

import { useSchemeOverride } from '@/shared/hooks/scheme-override';

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
export function useDeviceColorScheme() {
  const hasHydrated = useSyncExternalStore(subscribe, onClient, onServer);
  const colorScheme = useRNColorScheme();
  return hasHydrated ? colorScheme : 'light';
}

/**
 * The scheme to render: the in-app choice when there is one, the device
 * otherwise. The override's server snapshot is `null`, so a static render still
 * takes the device branch above and hydrates without a mismatch.
 */
export function useColorScheme() {
  const override = useSchemeOverride();
  const device = useDeviceColorScheme();
  return override ?? device;
}
