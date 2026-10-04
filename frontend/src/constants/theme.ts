/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

// SSAA brand tokens, matched to the original Lovable app's HSL theme
// (SSAA/src/index.css) so the two apps look like the same product.
export const Colors = {
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
    brandBackground: '#F1F5F9',
    brandForeground: '#0F172A',
    card: '#F8FAFC',
    primary: '#0284C7',
    primaryForeground: '#F0F9FF',
    secondary: '#334155',
    secondaryForeground: '#F8FAFC',
    muted: '#94A3B8',
    mutedForeground: '#475569',
    destructive: '#DC2626',
    border: '#CBD5E1',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
    brandBackground: '#0F172A',
    brandForeground: '#F1F5F9',
    card: '#1E293B',
    primary: '#38BDF8',
    primaryForeground: '#0C4A6E',
    secondary: '#CBD5E1',
    secondaryForeground: '#0F172A',
    muted: '#475569',
    mutedForeground: '#CBD5E1',
    destructive: '#F87171',
    border: '#334155',
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

// Matches shadcn/ui's --radius: 0.5rem (8px) base, with md/sm derived the
// same way (SSAA/tailwind.config.ts: lg = radius, md = radius - 2, sm = radius - 4).
export const Radius = {
  sm: 4,
  md: 6,
  lg: 8,
  full: 9999,
} as const;
