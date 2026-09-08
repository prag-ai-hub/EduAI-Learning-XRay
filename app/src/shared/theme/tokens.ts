/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/shared/theme/global.css';

import { Platform } from 'react-native';

/**
 * The web app's palette, verbatim. The product has one visual language; a
 * second set of colours invented here would drift from
 * frontend/app/globals.css the first time either changed.
 */
export const Colors = {
  light: {
    text: '#1d1d1f',
    background: '#f7f7f5',
    backgroundElement: '#ffffff',
    backgroundSelected: '#f2f3f5',
    textSecondary: '#6e6e73',
    border: '#dfe1e5',
    navy: '#283b65',
    orange: '#f6a017',
    green: '#2e7d32',
    red: '#b3261e',
  },
  dark: {
    text: '#f5f5f7',
    background: '#101216',
    backgroundElement: '#191c22',
    backgroundSelected: '#22262e',
    textSecondary: '#a7aab1',
    border: '#343944',
    navy: '#283b65',
    orange: '#f6a017',
    green: '#2e7d32',
    red: '#b3261e',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
