import { useColorScheme as useNativeColorScheme } from 'react-native';

import { useSchemeOverride } from '@/shared/hooks/scheme-override';

/** What the device is set to, ignoring any in-app choice. */
export function useDeviceColorScheme() {
  return useNativeColorScheme();
}

/**
 * The scheme to render: the in-app choice when there is one, the device
 * otherwise. See `@/shared/hooks/scheme-override` for why this is not
 * `Appearance.setColorScheme`.
 */
export function useColorScheme() {
  const override = useSchemeOverride();
  const device = useDeviceColorScheme();
  return override ?? device;
}
