/**
 * The route tree's root.
 *
 * A Stack, not the tab bar the Expo template shipped with. Those two tabs
 * ("Home" and "Explore") were scaffolding: this product's public surface is a
 * marketing page that leads to sign-in, and its signed-in surface is a
 * workspace with its own sidebar. Neither is a tab, and leaving `AppTabs` here
 * meant the ported routes existed but could only be reached by typing a URL.
 *
 * Every screen draws its own chrome - MarketingHome has a nav, the auth screens
 * are full-bleed two-pane layouts - so headers are off globally rather than
 * turned off six times.
 */

import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';

import { AnimatedSplashOverlay } from '@/shared/components/animated-icon';
// The app's hook, not React Native's: it honours the in-app appearance choice,
// so the navigator's background follows the same scheme as every screen on it.
import { useColorScheme } from '@/shared/hooks/use-color-scheme';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <Stack screenOptions={{ headerShown: false }} />
    </ThemeProvider>
  );
}
