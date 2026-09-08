/**
 * The web design system, translated to React Native.
 *
 * Source of truth: frontend/app/globals.css, frontend/app/marketing.css and
 * frontend/app/persistence.css. Every value below is lifted from those files;
 * nothing here is invented. Colours are never written as literals - they are
 * either a token from `@/shared/theme/tokens` or a computed function of one, so the
 * palette stays single-sourced exactly as `:root { --navy: ... }` was on the web.
 *
 * What the CSS could not bring across (grid, :hover, ::before, media queries,
 * sticky, gradients) is listed at the bottom of this file under CAVEATS, with
 * the construct that replaced it.
 *
 * Usage:
 *   const s = useAppStyles();          // scheme + breakpoint aware
 *   <View style={s.card}>...</View>
 *   <Pressable style={({ hovered }) => [s.workCard, hovered && s.workCardHover]} />
 */

import { useMemo } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';

import { Colors } from '@/shared/theme/tokens';
import { useColorScheme } from '@/shared/hooks/use-color-scheme';

/* ------------------------------------------------------------------------- *
 * 1. Colour algebra
 *
 * globals.css leans on `color-mix(in srgb, var(--navy) 7%, var(--surface))` and
 * on hand-picked tints of the same six brand hues. These helpers reproduce that
 * arithmetic at module load so no derived colour has to be hardcoded.
 * ------------------------------------------------------------------------- */

const CHANNEL_MAX = 255;

type Rgb = { r: number; g: number; b: number };

function channels(color: string): Rgb {
  const value = color.trim();

  if (value.startsWith('#')) {
    const hex = value.slice(1);
    const full =
      hex.length === 3
        ? hex
            .split('')
            .map((c) => c + c)
            .join('')
        : hex;
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
    };
  }

  const parts = value
    .replace(/^rgba?\(/, '')
    .replace(/\)$/, '')
    .split(',')
    .map((part) => Number(part.trim()));

  return { r: parts[0] ?? 0, g: parts[1] ?? 0, b: parts[2] ?? 0 };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function toRgb({ r, g, b }: Rgb): string {
  return 'rgb(' + Math.round(r) + ', ' + Math.round(g) + ', ' + Math.round(b) + ')';
}

/** The two achromatic endpoints. Not brand colours - channel extremes. */
const WHITE = toRgb({ r: CHANNEL_MAX, g: CHANNEL_MAX, b: CHANNEL_MAX });
const BLACK = toRgb({ r: 0, g: 0, b: 0 });
const TRANSPARENT = 'transparent';

/** `color-mix(in srgb, base <weight * 100>%, other)`. */
export function mix(base: string, other: string, weight: number): string {
  const a = channels(base);
  const b = channels(other);
  const w = clamp01(weight);
  return toRgb({
    r: a.r * w + b.r * (1 - w),
    g: a.g * w + b.g * (1 - w),
    b: a.b * w + b.b * (1 - w),
  });
}

/** Lighten toward white. `amount` is how much white is added. */
export function tint(color: string, amount: number): string {
  return mix(color, WHITE, 1 - clamp01(amount));
}

/** Darken toward black. `amount` is how much black is added. */
export function shade(color: string, amount: number): string {
  return mix(color, BLACK, 1 - clamp01(amount));
}

/** `rgba(color, a)` - the CSS `rgba(...)` and `color-mix(..., transparent)` forms. */
export function alpha(color: string, a: number): string {
  const { r, g, b } = channels(color);
  return (
    'rgba(' +
    Math.round(r) +
    ', ' +
    Math.round(g) +
    ', ' +
    Math.round(b) +
    ', ' +
    clamp01(a) +
    ')'
  );
}

/* ------------------------------------------------------------------------- *
 * 2. Derived palette
 *
 * `Colors` carries the ten values `:root` declared. globals.css also uses ~60
 * one-off tints of those ten; each is reconstructed here as a mix, with the CSS
 * value it reproduces named in the comment. Where the web had a genuinely
 * separate sub-palette with no counterpart in `Colors` (marketing `--m-*`, the
 * traffic-light matrix, the review-workspace violet) it is mapped onto the
 * nearest brand hue rather than approximated into a new colour - see CAVEATS.
 * ------------------------------------------------------------------------- */

export type Scheme = 'light' | 'dark';

export type Palette = ReturnType<typeof palette>;

export function palette(scheme: Scheme) {
  const c = Colors[scheme];
  const dark = scheme === 'dark';

  return {
    /* --- the ten declared in :root --- */
    bg: c.background, // --bg
    surface: c.backgroundElement, // --surface
    surface2: c.backgroundSelected, // --surface2
    text: c.text, // --text
    muted: c.textSecondary, // --muted
    border: c.border, // --border
    navy: c.navy, // --navy
    orange: c.orange, // --orange
    green: c.green, // --green
    red: c.red, // --red

    /* --- achromatic --- */
    white: WHITE, // #fff on navy / on gradients
    black: BLACK,
    transparent: TRANSPARENT,

    /* --- structural tints of navy --- */
    navyWash: mix(c.navy, c.backgroundElement, 0.05), // #f8fafc, #f7f9fd
    navyTint: mix(c.navy, c.backgroundElement, 0.07), // #eef1f7 nav active, #f0f3f9 .insight
    navyTintStrong: mix(c.navy, c.backgroundElement, dark ? 0.45 : 0.1), // #e7ebf4 / dark #252d3e
    navyEdge: mix(c.navy, c.backgroundElement, 0.12), // #e4e9f3 avatar, #d9e3f2 matrix border
    navyMid: mix(c.navy, WHITE, 0.5), // #8aa0c3 heat "partial"
    navyDeep: shade(c.navy, 0.3), // #1e2b47 toast, #0b214b parent hero
    navyInk: shade(c.navy, 0.55), // --m-ink #0f1b2d, #172644 login gradient head
    onNavy: WHITE, // #fff
    onNavyLead: mix(c.navy, WHITE, 0.18), // #d9e1f1 login lead
    onNavyFaint: mix(c.navy, WHITE, 0.25), // #c9d3e7, #dbe8fb
    onNavyLine: alpha(WHITE, 0.14), // rgba(255,255,255,.14)
    onNavyFill: alpha(WHITE, 0.06), // rgba(255,255,255,.06)

    /* --- greys (the #667085 / #687386 / #8a8d92 family) --- */
    inkSoft: mix(c.textSecondary, c.navy, 0.35), // #3e4b5f hero lead
    inkMuted: mix(c.textSecondary, c.navy, 0.8), // #687386, #667085, #5c6676
    inkFaint: tint(c.textSecondary, 0.25), // #8a8d92 dividers, footers

    /* --- status: warning (orange family) --- */
    warningBg: tint(c.orange, 0.85), // #fff2d7
    warningText: shade(c.orange, 0.48), // #805200
    warningSoftBg: tint(c.orange, 0.8), // #fff0ce developing / average
    warningSoftText: shade(c.orange, 0.53), // #744d00
    warningPillBg: tint(c.orange, 0.82), // #ffead1 .status.orange
    warningPillText: shade(c.orange, 0.44), // #8a4700

    /* --- status: success (green family) --- */
    successBg: tint(c.green, 0.9), // #e9f5ea
    successText: shade(c.green, 0.2), // #206429
    successSoftBg: tint(c.green, 0.82), // #dceedd mastered / excellent
    successSoftText: shade(c.green, 0.25), // #205c26
    successPillBg: tint(c.green, 0.86), // #dcfce7 .status.green
    successAccent: tint(c.green, 0.45), // #9dd5a2 toast highlight

    /* --- status: danger (red family) --- */
    dangerBg: tint(c.red, 0.92), // #fff0ee .form-error, .validation-summary
    dangerText: shade(c.red, 0.23), // #8a211b
    dangerSoftBg: tint(c.red, 0.84), // #f6dedc gap / weak
    dangerSoftText: shade(c.red, 0.3), // #7d211b
    dangerPillBg: tint(c.red, 0.88), // #fee2e2 .status.red
    dangerStrong: shade(c.red, 0.11), // #a02b24 .danger
    dangerBright: tint(c.red, 0.1), // #bb3a32 marketing grade stamp

    /* --- neutral tier --- */
    neutralBg: mix(c.border, c.backgroundElement, 0.75), // #e6e8ec .review tier
    neutralText: shade(c.textSecondary, 0.22), // #565b63

    /* --- accents --- */
    amberSoft: tint(c.orange, 0.72), // #f7e3bc profile avatar, #ffdfaa gap tag
    amberText: shade(c.orange, 0.58), // #68450a, #6d4400
    amberBright: tint(c.orange, 0.14), // #ffad32 parent hero label
    amberPale: tint(c.orange, 0.25), // #f7bd5d, #f4b95f on-navy eyebrow
    amberLift: tint(c.orange, 0.55), // #ffd52b matrix "yellow" tier - see CAVEATS
    amberDeep: shade(c.orange, 0.33), // #a46200 marketing eyebrow

    /* --- lines and fields --- */
    line: c.border,
    lineWarm: mix(c.border, c.orange, 0.9), // --m-line #d9d4ca
    lineOnDark: alpha(WHITE, 0.22),
    dropzoneBorder: mix(c.border, c.textSecondary, 0.45), // #a8afbc
    field: c.backgroundElement,

    /* --- shadow colour (--shadow) --- */
    shadow: dark ? alpha(BLACK, 0.24) : alpha(shade(c.navy, 0.38), 0.07),
    shadowStrong: dark ? alpha(BLACK, 0.4) : alpha(shade(c.navy, 0.38), 0.18),

    /* --- scrim --- */
    scrim: alpha(shade(c.navy, 0.75), 0.5), // rgba(10,15,24,.5)
  } as const;
}

/* ------------------------------------------------------------------------- *
 * 3. Scales lifted from the CSS
 * ------------------------------------------------------------------------- */

/** Every spacing step that appears in the three stylesheets, in px. */
export const Space = {
  s0: 0,
  s1: 1,
  s2: 2,
  s3: 3,
  s4: 4,
  s5: 5,
  s6: 6,
  s7: 7,
  s8: 8,
  s9: 9,
  s10: 10,
  s11: 11,
  s12: 12,
  s13: 13,
  s14: 14,
  s15: 15,
  s16: 16,
  s17: 17,
  s18: 18,
  s20: 20,
  s22: 22,
  s24: 24,
  s25: 25,
  s26: 26,
  s28: 28,
  s30: 30,
  s32: 32,
  s34: 34,
  s36: 36,
  s38: 38,
  s40: 40,
  s42: 42,
  s44: 44,
  s48: 48,
  s52: 52,
  s55: 55,
  s58: 58,
  s60: 60,
  s64: 64,
  s70: 70,
  s72: 72,
  s76: 76,
  s80: 80,
  s90: 90,
  s100: 100,
  s110: 110,
  s120: 120,
} as const;

/** The roles those steps play, so callers do not have to remember numbers. */
export const Layout = {
  sidebarWidth: 236, // .sidebar
  topbarHeight: 64, // .topbar
  topbarHeightCompact: 58,
  contentMaxWidth: 1320, // .content
  contentPaddingX: Space.s34,
  contentPaddingTop: Space.s36,
  contentPaddingBottom: Space.s72,
  contentPaddingXCompact: Space.s15,
  modalMaxWidth: 560, // .modal
  loginCardWidth: 420, // .login-card
  demoCardWidth: 470, // .demo-auth-card
  legalMaxWidth: 760, // .legal-page
  parentMaxWidth: 980, // .parent-dashboard > *
  navigatorWidth: 270, // .continuous-review-layout right rail
  navigatorViewportInset: 100, // .question-navigator max-height: calc(100vh - 100px)
  summaryCompactWidth: 250, // .review-summary-compact
  matrixMinWidth: 720, // .principal-matrix
  heatMinWidth: 760, // .mkt-heat, .resource-row
  mobileNavColumns: 5,
} as const;

/** border-radius values. `pill` is the CSS 999px; `circle` needs size / 2. */
export const Radius = {
  xs: 2,
  sm: 6,
  input: 9,
  chip: 8,
  md: 10,
  lg: 11,
  button: 11,
  xl: 12,
  xxl: 14,
  panel: 15,
  card: 18,
  modal: 20,
  hero: 24,
  phone: 38,
  pill: 999,
  circle: (size: number) => size / 2,
} as const;

/** Font sizes present in the CSS, 7px through the hero display sizes. */
export const FontSize = {
  f7: 7,
  f8: 8,
  f9: 9,
  f10: 10,
  f11: 11,
  f12: 12,
  f13: 13,
  f14: 14,
  f15: 15,
  f16: 16,
  f17: 17,
  f18: 18,
  f19: 19,
  f20: 20,
  f22: 22,
  f23: 23,
  f24: 24,
  f25: 25,
  f26: 26,
  f27: 27,
  f28: 28,
  f30: 30,
  f32: 32,
  f34: 34,
  f37: 37,
  f38: 38,
  f42: 42,
  f44: 44,
  f48: 48,
  f56: 56,
  f68: 68,
  f72: 72,
  f88: 88,
} as const;

/**
 * CSS used 500/600/700/750/800/850/900. React Native only accepts the hundreds,
 * so 750 rounds to 700 and 850 rounds to 800 (see CAVEATS).
 */
export const FontWeight = {
  regular: '500',
  medium: '600',
  bold: '700',
  heavy: '800',
  black: '900',
} as const;

/** line-height as a multiplier; RN wants px, so multiply by the font size. */
export const LineHeight = {
  tight: 1.02,
  snug: 1.1,
  base: 1.45,
  body: 1.55,
  relaxed: 1.65,
  loose: 1.75,
} as const;

/** `letter-spacing` was in `em`; RN wants px, so these are per-em factors. */
export const Tracking = {
  display: -0.05, // .login-story h1, .demo-auth-card h2
  heading: -0.04, // .page-heading h1, .metric b
  headingSoft: -0.02, // .card h2
  marketing: -0.045, // .mkt h1/h2/h3
  eyebrow: 0.11, // .eyebrow
  eyebrowWide: 0.14, // .mkt-eyebrow, .brand-document-header p
  label: 0.08, // .tr.th, .review-page > header
  caps: 0.12, // .diagnostic-gap-list header p
} as const;

/** Multiply a per-em tracking value by the font size to get RN px. */
export function letterSpacing(fontSize: number, em: number): number {
  return Math.round(fontSize * em * 100) / 100;
}

/**
 * Every width the three stylesheets branch on. `grep -o '@media[^{]*'` over
 * globals.css, marketing.css and persistence.css returns seven distinct
 * widths - 560, 680, 700, 760, 900, 1000, 1050 - plus `print` and
 * `prefers-reduced-motion`, which are not widths. All seven are reproduced.
 */
export const Breakpoints = {
  /** globals.css @media(max-width:560px) - .assessment-source-picker, the demo-auth type ramp. */
  mini: 560,
  /** marketing.css @media(max-width:680px) - the whole marketing page's phone layout. */
  mktCompact: 680,
  /** globals.css @media(max-width:700px) - .parent-summary, .parent-dashboard. */
  parent: 700,
  /** globals.css + persistence.css @media(max-width:760px) - the app's phone layout. */
  compact: 760,
  /** globals.css @media(max-width:900px) - .demo-auth splits into two rows. */
  demoAuth: 900,
  /** marketing.css @media(max-width:1000px) - the marketing tablet layout. */
  mktMedium: 1000,
  /** globals.css @media(max-width:1050px) - the app's tablet layout. */
  medium: 1050,
} as const;

/**
 * The app shell's own breakpoint - the one components branch on, because it is
 * what moves the sidebar out (760) and the review rail out (1050). The other
 * four widths are resolved from the raw window width inside `createStyles`;
 * see the BREAKPOINTS note in CAVEATS.
 */
export type LayoutSize = 'compact' | 'medium' | 'wide';

export function layoutFor(width: number): LayoutSize {
  if (width <= Breakpoints.compact) return 'compact';
  if (width <= Breakpoints.medium) return 'medium';
  return 'wide';
}

/** The window a sheet is built for. `useAppStyles` fills it from `useWindowDimensions`. */
export type Viewport = { width: number; height: number };

/** A viewport consistent with a `LayoutSize`, for callers that only have the bucket. */
export function viewportFor(size: LayoutSize): Viewport {
  if (size === 'compact') return { width: 390, height: 844 };
  if (size === 'medium') return { width: 900, height: 1200 };
  return { width: 1440, height: 900 };
}

/* ------------------------------------------------------------------------- *
 * 4. Shadow and grid helpers
 *
 * `box-shadow` becomes RN's `boxShadow` string (supported on the new
 * architecture and by react-native-web), so blur/spread/offset survive intact.
 * `elevation` is added alongside for old-architecture Android builds.
 * ------------------------------------------------------------------------- */

export function shadow(color: string, y: number, blur: number): string {
  return '0px ' + y + 'px ' + blur + 'px ' + color;
}

/** Ring shadows (`box-shadow: 0 0 0 2px x`) - the CSS focus/selection rings. */
export function ring(color: string, width: number): string {
  return '0px 0px 0px ' + width + 'px ' + color;
}

/**
 * `grid-template-columns: repeat(n, 1fr)` on a wrapping flex row.
 *
 * This is the piece `track()` cannot express. A `flexBasis: 0` track has a
 * hypothetical main size of zero, so *every* child fits on the first line and
 * the row never breaks: `.work-grid` (4 columns) holding eight cards renders
 * eight slivers on one line instead of two rows of four. A percentage basis
 * restores the column count - `n` tracks fit, the `n + 1`th is pushed down.
 *
 * The basis is pulled `100 / (2n(n+1))` below `100 / n` so the row's `gap` has
 * somewhere to live: `n` tracks of exactly `100 / n` already fill the line, and
 * the gaps between them would push the last one onto a row of its own. That
 * slack is half of the largest value that still forces a break after `n`
 * tracks, so `n` tracks fit on any container at least `2 * (n^2 - 1) * gap`
 * wide - 108px for two 18px-gap columns, 360px for four 12px-gap columns, 480px
 * for five 10px-gap columns. Every container in this app clears that by a wide
 * margin. `flexGrow` then eats the slack back, so a full row still spans the
 * container exactly, as the grid did.
 *
 * The one place this still differs from CSS grid: a partly filled final row
 * stretches its children across the container instead of leaving the missing
 * columns empty. `Grid.filler` restores that when it matters.
 */
export function gridColumns(n: number, fr = 1) {
  if (n <= 1) return { flexGrow: fr, flexShrink: 1, flexBasis: '100%' as const, minWidth: 0 };

  const basis = 100 / n - 100 / (2 * n * (n + 1));
  return {
    flexGrow: fr,
    flexShrink: 1,
    flexBasis: (Math.round(basis * 100) / 100 + '%') as `${number}%`,
    minWidth: 0,
  };
}

/**
 * `display: grid; grid-template-columns: ...` has no RN equivalent. A row of
 * flex children reproduces it: the container wraps, and each track carries its
 * own width. Pick `columns()` when the grid holds more children than it has
 * columns and has to wrap; `track()` when the row is a single line of cells.
 */
export const Grid = {
  /** The `display:grid` container. */
  row(gap: number) {
    return { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap };
  },
  /**
   * One `1fr` track (or `1.5fr` with `fr = 1.5`) of a grid that is *one line*:
   * a table row, a five-cell strip with exactly five cells. A zero basis keeps
   * the weights exact but defeats wrapping - see `columns()`.
   */
  track(fr = 1) {
    return { flexGrow: fr, flexShrink: 1, flexBasis: 0, minWidth: 0 };
  },
  /** One track of `repeat(n, 1fr)` on a grid that wraps. See `gridColumns`. */
  columns: gridColumns,
  /**
   * An invisible track. A wrapped flex row stretches a partly filled final row
   * across the container where CSS grid would leave the empty columns empty;
   * render up to `n - 1` of these (zero-height, no content) after the real
   * children to hold those columns open.
   */
  filler(n: number) {
    return { ...gridColumns(n), height: 0 };
  },
  /** `minmax(min, 1fr)` - grows, but never below `min`, and wraps instead. */
  minTrack(min: number, fr = 1) {
    return { flexGrow: fr, flexShrink: 1, flexBasis: min, minWidth: min };
  },
  /** `repeat(auto-fit, minmax(min, 1fr))` - as many `min`-wide tracks as fit. */
  autoFit(min: number) {
    return { flexGrow: 1, flexShrink: 1, flexBasis: min, minWidth: min };
  },
  /** A fixed-width track, e.g. `grid-template-columns: 100px 1fr`. */
  fixed(width: number) {
    return { width, flexGrow: 0, flexShrink: 0 };
  },
  /** `grid-column: 1 / -1` and `grid-column: span 2` on a full-width row. */
  span: { width: '100%' as const, flexBasis: '100%' as const },
} as const;

/* ------------------------------------------------------------------------- *
 * 5. The stylesheet
 * ------------------------------------------------------------------------- */

export function createStyles(
  scheme: Scheme = 'light',
  size: LayoutSize = 'wide',
  viewport: Viewport = viewportFor(size),
) {
  const p = palette(scheme);

  /* The app shell's two buckets - what `LayoutSize` exists for. */
  const compact = size === 'compact'; // <= 760: sidebar out, mobile nav in
  const wide = size === 'wide'; // > 1050: the review rail is beside the paper

  /* The four widths the shell's buckets cannot express, resolved from the
   * window. Each maps to exactly one media query - see CAVEATS/BREAKPOINTS. */
  const w = viewport.width;
  const mini = w <= Breakpoints.mini; // <= 560  globals.css
  const mktCompact = w <= Breakpoints.mktCompact; // <= 680  marketing.css
  const parentCompact = w <= Breakpoints.parent; // <= 700  globals.css
  const demoCompact = w <= Breakpoints.demoAuth; // <= 900  globals.css
  const mktWide = w > Breakpoints.mktMedium; // > 1000  marketing.css

  const cardShadow = shadow(p.shadow, compact ? 6 : 12, compact ? 18 : 34);

  return StyleSheet.create({
    /* ===================== shell ===================== */
    appShell: { flex: 1, backgroundColor: p.bg }, // .app-shell min-height:100vh
    sidebar: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: 0,
      width: Layout.sidebarWidth,
      paddingVertical: Space.s20,
      paddingHorizontal: Space.s14,
      backgroundColor: p.surface,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: p.border,
      zIndex: 20,
      display: compact ? 'none' : 'flex',
    },
    brand: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.s10,
      paddingVertical: Space.s7,
      paddingHorizontal: Space.s10,
      marginBottom: Space.s28,
      cursor: 'pointer',
    },
    brandLogo: { width: 34, height: 38 }, // object-fit:contain -> resizeMode="contain"
    brandName: { fontSize: FontSize.f15, color: p.text, fontWeight: FontWeight.bold },
    brandTagline: { fontSize: FontSize.f10, color: p.muted, marginTop: Space.s2 },
    sidebarNav: { gap: Space.s5 },
    navButton: {
      height: 43,
      borderRadius: Radius.xl,
      backgroundColor: p.transparent,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.s11,
      paddingHorizontal: Space.s12,
      cursor: 'pointer',
    },
    navButtonActive: { backgroundColor: scheme === 'dark' ? p.navyTintStrong : p.navyTint },
    navButtonLabel: { color: p.muted, fontWeight: FontWeight.medium, fontSize: FontSize.f14 },
    navButtonLabelActive: { color: scheme === 'dark' ? p.white : p.navy },
    navIcon: { fontSize: FontSize.f20, width: 22, textAlign: 'center' },
    navBadge: {
      marginLeft: 'auto',
      backgroundColor: p.orange,
      borderRadius: Radius.pill,
      paddingVertical: Space.s2,
      paddingHorizontal: Space.s7,
    },
    navBadgeText: { color: p.amberText, fontSize: FontSize.f10, fontWeight: FontWeight.heavy },
    sidebarFoot: { marginTop: 'auto' },
    privacyNote: {
      flexDirection: 'row',
      gap: Space.s9,
      padding: Space.s11,
      marginBottom: Space.s8,
      backgroundColor: p.surface2,
      borderRadius: Radius.xl,
    },
    privacyNoteIcon: { color: p.green },
    privacyNoteTitle: { fontSize: FontSize.f11, color: p.text, fontWeight: FontWeight.bold },
    privacyNoteCaption: { fontSize: FontSize.f10, color: p.muted, marginTop: Space.s2 },
    profile: {
      width: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.s9,
      padding: Space.s9,
      cursor: 'pointer',
    },
    profileAvatar: {
      width: 32,
      height: 32,
      borderRadius: Radius.circle(32),
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: p.amberSoft,
    },
    profileAvatarText: {
      color: p.amberText,
      fontSize: FontSize.f11,
      fontWeight: FontWeight.bold,
    },
    profileName: { fontSize: FontSize.f12, color: p.text, fontWeight: FontWeight.bold },
    profileCaption: { fontSize: FontSize.f10, color: p.muted, marginTop: Space.s2 },
    profileChevron: { marginLeft: 'auto', color: p.muted },

    main: { flex: 1, marginLeft: compact ? 0 : Layout.sidebarWidth },
    topbar: {
      height: compact ? Layout.topbarHeightCompact : Layout.topbarHeight,
      zIndex: 10,
      backgroundColor: p.surface, // color-mix(--surface 89%, transparent) + blur - see CAVEATS
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: p.border,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: compact ? Space.s15 : Space.s30,
    },
    crumb: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.s9,
      display: compact ? 'none' : 'flex',
    },
    crumbText: { fontSize: FontSize.f12, color: p.muted },
    crumbCurrent: { fontSize: FontSize.f12, color: p.text },
    topActions: {
      marginLeft: 'auto',
      flexDirection: 'row',
      gap: Space.s8,
      alignItems: 'center',
    },
    topActionButton: {
      height: 36,
      minWidth: 36,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      backgroundColor: p.surface,
      borderRadius: Radius.md,
      paddingHorizontal: Space.s10,
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
    },
    topActionBadge: { position: 'absolute', right: -5, top: -5 },
    mobileBrand: {
      display: compact ? 'flex' : 'none',
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.s7,
    },
    mobileBrandLogo: { width: 26, height: 29 },
    mobileNav: {
      display: compact ? 'flex' : 'none',
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      flexDirection: 'row',
      backgroundColor: p.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: p.border,
      zIndex: 30,
      paddingHorizontal: Space.s4,
      paddingTop: Space.s7,
      paddingBottom: Space.s7, // + useSafeAreaInsets().bottom - see CAVEATS
    },
    mobileNavButton: { flex: 1, alignItems: 'center', gap: Space.s2 },
    mobileNavLabel: { fontSize: FontSize.f8, color: p.muted },
    mobileNavLabelActive: { color: scheme === 'dark' ? p.white : p.navy },
    mobileNavIcon: { fontSize: FontSize.f19 },

    content: {
      width: '100%',
      maxWidth: Layout.contentMaxWidth,
      marginHorizontal: 'auto',
      paddingHorizontal: compact ? Layout.contentPaddingXCompact : Layout.contentPaddingX,
      paddingTop: compact ? Space.s26 : Layout.contentPaddingTop,
      paddingBottom: compact ? Space.s90 : Layout.contentPaddingBottom,
    },

    /* ===================== page heading and type ===================== */
    pageHeading: {
      flexDirection: compact ? 'column' : 'row',
      justifyContent: 'space-between',
      alignItems: compact ? 'flex-start' : 'flex-end',
      gap: Space.s24,
      marginBottom: Space.s26,
    },
    pageHeadingTitle: {
      fontSize: compact ? FontSize.f26 : FontSize.f32,
      letterSpacing: letterSpacing(compact ? FontSize.f26 : FontSize.f32, -0.035),
      color: p.text,
      marginTop: Space.s4,
      marginBottom: Space.s6,
      fontWeight: FontWeight.bold,
    },
    pageHeadingLead: { color: p.muted, fontSize: FontSize.f14 },
    /**
     * `@media(max-width:760px){ .page-heading > button { position: fixed;
     * right: 15px; bottom: 78px; z-index: 12;
     * box-shadow: 0 8px 28px rgba(40,59,101,.32) } }` - on phones the heading's
     * action detaches and floats clear of the mobile nav.
     *
     * `position: fixed` has no RN equivalent, so the button has to be rendered
     * as an absolutely positioned sibling of the page ScrollView inside
     * `appShell` rather than inside `pageHeading`; above 760px this style is
     * empty and it stays in the heading row. rgba(40,59,101,...) is `--navy`.
     */
    pageHeadingFab: compact
      ? {
          position: 'absolute',
          right: Layout.contentPaddingXCompact,
          bottom: 78, // clears .mobile-nav
          zIndex: 12,
          boxShadow: shadow(alpha(p.navy, 0.32), 8, 28),
        }
      : {},
    eyebrow: {
      textTransform: 'uppercase',
      letterSpacing: letterSpacing(FontSize.f10, Tracking.eyebrow),
      fontSize: FontSize.f10,
      color: p.muted,
      fontWeight: FontWeight.heavy,
    },
    eyebrowOnNavy: { color: p.amberPale },

    /* ===================== buttons ===================== */
    primary: {
      minHeight: 40,
      borderRadius: Radius.button,
      paddingHorizontal: Space.s16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.navy,
      backgroundColor: p.navy,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: Space.s8,
      boxShadow: shadow(alpha(p.navy, 0.18), 6, 16),
      cursor: 'pointer',
    },
    primaryText: { color: p.onNavy, fontWeight: FontWeight.bold, fontSize: FontSize.f12 },
    primaryHover: { backgroundColor: tint(p.navy, 0.12) }, // :hover filter:brightness(1.12)
    primaryDisabled: { opacity: 0.5, cursor: 'auto' },
    secondary: {
      minHeight: 40,
      borderRadius: Radius.button,
      paddingHorizontal: Space.s16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      backgroundColor: p.surface,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: Space.s8,
      cursor: 'pointer',
    },
    secondaryText: { color: p.text, fontWeight: FontWeight.bold, fontSize: FontSize.f12 },
    link: { minHeight: 40, justifyContent: 'center', cursor: 'pointer' },
    linkText: { color: p.navy, fontWeight: FontWeight.bold, fontSize: FontSize.f12 },
    buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.s8 },
    buttonRowEnd: { justifyContent: 'flex-end' },
    full: { width: '100%', marginTop: Space.s18, justifyContent: 'center' },
    rowButton: {
      width: '100%',
      backgroundColor: p.surface,
      alignItems: 'flex-start',
      cursor: 'pointer',
    },
    rowButtonHover: { backgroundColor: p.surface2 },

    /* ===================== metrics ===================== */
    metricGrid: compact
      ? { flexDirection: 'row', gap: Space.s13, marginBottom: Space.s18 } // horizontal ScrollView
      : { flexDirection: 'row', flexWrap: 'wrap', gap: Space.s13, marginBottom: Space.s18 },
    // repeat(4,1fr) at every width; at <=760 the grid is a horizontal scroll
    // strip and `.metric-grid .metric{min-width:154px}` takes over.
    metricTrack: compact ? { minWidth: 154, flexGrow: 0 } : Grid.columns(4),
    // .metric-grid.five is repeat(5,1fr), dropping to repeat(3,1fr) at <=1050.
    metricTrackFive: compact ? { minWidth: 154, flexGrow: 0 } : Grid.columns(wide ? 5 : 3),
    metric: {
      minHeight: 128,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      backgroundColor: p.surface,
      borderRadius: Radius.xxl + 2,
      padding: Space.s18,
      boxShadow: shadow(alpha(p.black, 0.02), 2, 8),
      cursor: 'pointer',
    },
    metricLabel: { fontSize: FontSize.f11, color: p.muted, fontWeight: FontWeight.bold },
    metricValue: {
      fontSize: FontSize.f27,
      letterSpacing: letterSpacing(FontSize.f27, Tracking.heading),
      color: p.text,
      marginTop: Space.s8,
      marginBottom: Space.s4,
      fontWeight: FontWeight.heavy,
    },
    metricCaption: { fontSize: FontSize.f10, color: p.muted },
    metricNavy: { borderTopWidth: 3, borderTopColor: p.navy },
    metricOrange: { borderTopWidth: 3, borderTopColor: p.orange },
    metricRed: { borderTopWidth: 3, borderTopColor: p.red },
    metricGreen: { borderTopWidth: 3, borderTopColor: p.green },

    /* ===================== cards ===================== */
    dashboardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.s18 },
    dashboardTrack: compact ? { width: '100%', flexBasis: '100%' } : Grid.columns(2),
    card: {
      backgroundColor: p.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      borderRadius: Radius.card,
      padding: compact ? Space.s17 : Space.s22,
      boxShadow: cardShadow,
    },
    cardSpan2: compact ? { width: '100%' } : { width: '100%', flexBasis: '100%' },
    cardTitle: {
      fontSize: FontSize.f18,
      letterSpacing: letterSpacing(FontSize.f18, Tracking.headingSoft),
      color: p.text,
      marginTop: Space.s4,
      marginBottom: Space.s9,
      fontWeight: FontWeight.bold,
    },
    cardBody: { color: p.muted, fontSize: FontSize.f13, lineHeight: FontSize.f13 * LineHeight.body },
    cardHead: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: Space.s14,
      marginBottom: Space.s15,
    },
    selectedCard: { boxShadow: ring(p.navy, 2), transform: [{ translateY: -2 }] },

    /* ===================== status pills ===================== */
    status: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 25,
      borderRadius: Radius.pill,
      paddingHorizontal: Space.s9,
      backgroundColor: p.surface2,
    },
    statusText: { fontSize: FontSize.f9, fontWeight: FontWeight.heavy, color: p.muted },
    statusWarning: { backgroundColor: p.warningBg },
    statusWarningText: { color: p.warningText },
    statusSuccess: { backgroundColor: p.successBg },
    statusSuccessText: { color: p.successText },
    statusNeutral: { backgroundColor: p.surface2 },
    statusNeutralText: { color: p.muted },
    statusGreen: { backgroundColor: p.successPillBg },
    statusGreenText: { color: p.successText },
    statusYellow: { backgroundColor: tint(p.orange, 0.9) }, // #fff8cc
    statusYellowText: { color: shade(p.orange, 0.56) }, // #6b5600
    statusOrange: { backgroundColor: p.warningPillBg },
    statusOrangeText: { color: p.warningPillText },
    statusRed: { backgroundColor: p.dangerPillBg },
    statusRedText: { color: p.dangerText },
    danger: { color: p.dangerStrong },

    /* ===================== insight, evidence, notes ===================== */
    insight: {
      backgroundColor: p.navyTintStrong,
      borderRadius: Radius.xl,
      paddingVertical: Space.s11,
      paddingHorizontal: Space.s13,
    },
    insightText: {
      color: scheme === 'dark' ? p.onNavyFaint : p.navy,
      fontSize: FontSize.f11,
      lineHeight: FontSize.f11 * LineHeight.body,
    },
    evidence: {
      padding: Space.s12,
      backgroundColor: p.surface2,
      borderRadius: Radius.lg,
      marginVertical: Space.s10,
    },
    evidenceTitle: { fontSize: FontSize.f10, color: p.text, fontWeight: FontWeight.bold },
    evidenceBody: {
      color: p.muted,
      fontSize: FontSize.f10,
      lineHeight: FontSize.f10 * LineHeight.body,
      marginTop: Space.s6,
    },
    auditNote: {
      fontSize: FontSize.f8,
      color: p.muted,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: p.border,
      paddingTop: Space.s10,
    },
    storageNote: { fontSize: FontSize.f9, color: p.muted, marginTop: Space.s14 },
    emptyState: {
      alignItems: 'center',
      backgroundColor: p.surface2,
      borderRadius: Radius.xxl - 1,
      padding: Space.s34,
    },
    emptyStateTitle: { fontSize: FontSize.f13, color: p.text, fontWeight: FontWeight.bold },
    emptyStateBody: { fontSize: FontSize.f10, color: p.muted },

    /* ===================== tables and filters ===================== */
    table: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      borderRadius: Radius.xl,
      overflow: 'hidden',
    },
    tr: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: Space.s11,
      paddingHorizontal: Space.s14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: p.border,
      gap: Space.s12,
    },
    trLast: { borderBottomWidth: 0 },
    trHeader: { backgroundColor: p.surface2 },
    trHeaderText: {
      color: p.muted,
      fontSize: FontSize.f9,
      textTransform: 'uppercase',
      letterSpacing: letterSpacing(FontSize.f9, Tracking.label),
      fontWeight: FontWeight.heavy,
    },
    /*
     * `.tr` is `grid-template-columns: 2fr .8fr 1fr .7fr`, and at <=760 it
     * becomes `1.6fr .7fr .8fr` with `.tr > span:nth-child(3)` hidden - so the
     * fourth column slides into the third slot and the row stays three-up.
     * RN cannot put a template on the row, so each column carries its own
     * weight. The row is a single line, never a wrap, which is why these use
     * `Grid.track` (a zero basis) and not `Grid.columns`.
     * `.tr > span` is itself `flex-direction: column; gap: 3px`.
     */
    trColumn1: { gap: Space.s3, ...Grid.track(compact ? 1.6 : 2) },
    trColumn2: { gap: Space.s3, ...Grid.track(compact ? 0.7 : 0.8) },
    trColumn3: compact ? { display: 'none' } : { gap: Space.s3, ...Grid.track(1) },
    trColumn4: { gap: Space.s3, ...Grid.track(compact ? 0.8 : 0.7) },
    /** Generic `.tr > span` cells, for tables that are not the four-column one. */
    trCell: { gap: Space.s3, ...Grid.track(1) },
    trCellWide: { gap: Space.s3, ...Grid.track(compact ? 1.6 : 2) },
    trText: { fontSize: FontSize.f11, color: p.text },
    trCaption: { fontSize: FontSize.f11, color: p.muted },
    filters: { flexDirection: 'row', gap: Space.s6, marginTop: Space.s8, marginBottom: Space.s18 },
    filterChip: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      backgroundColor: p.surface,
      borderRadius: Radius.pill,
      paddingVertical: Space.s7,
      paddingHorizontal: Space.s12,
    },
    filterChipActive: { backgroundColor: p.navy, borderColor: p.navy },
    filterChipText: { fontSize: FontSize.f10, color: p.text },
    filterChipTextActive: { color: p.onNavy },

    /* ===================== work grid ===================== */
    workGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.s12 },
    workTrack: compact ? { width: '100%' } : Grid.columns(wide ? 4 : 2),
    workCard: {
      backgroundColor: p.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      borderRadius: Radius.xxl,
      padding: Space.s14,
      gap: Space.s7,
      cursor: 'pointer',
    },
    workCardHover: { transform: [{ translateY: -2 }], boxShadow: cardShadow },
    workCardTitle: { fontSize: FontSize.f12, color: p.text, fontWeight: FontWeight.bold },
    workCardCaption: { fontSize: FontSize.f10, color: p.muted },
    workCardAction: { color: p.navy, fontSize: FontSize.f10, fontWeight: FontWeight.heavy },
    miniPaper: { height: 66, backgroundColor: p.surface2, borderRadius: Radius.chip, padding: Space.s13 },
    miniPaperLine: { height: 4, backgroundColor: p.border, margin: Space.s5, borderRadius: Radius.sm - 1 },

    /* ===================== bars, chart, progress ===================== */
    qualityBars: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.s20 },
    barTrackCell: wide ? Grid.columns(3) : { width: '100%' },
    barHead: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: Space.s6,
    },
    barLabel: { fontSize: FontSize.f9, color: p.muted },
    barValue: { fontSize: FontSize.f9, color: p.text, fontWeight: FontWeight.bold },
    barTrack: { height: 6, backgroundColor: p.surface2, borderRadius: Radius.pill, overflow: 'hidden' },
    barFill: { height: '100%', backgroundColor: p.navy, borderRadius: Radius.pill },
    chart: {
      height: 230,
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: Space.s16,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: p.border,
      paddingTop: Space.s20,
      paddingHorizontal: Space.s15,
    },
    chartBar: {
      flex: 1,
      minHeight: 20,
      backgroundColor: p.navy, // linear-gradient(#6880ae -> navy) collapsed - see CAVEATS
      borderTopLeftRadius: Radius.sm,
      borderTopRightRadius: Radius.sm,
      cursor: 'pointer',
    },
    progress: {
      height: 15,
      width: '100%',
      backgroundColor: p.surface2,
      borderRadius: Radius.pill,
      overflow: 'hidden',
      justifyContent: 'center',
    },
    progressFill: { height: '100%', backgroundColor: p.navy, borderRadius: Radius.pill },
    progressLabel: {
      position: 'absolute',
      left: 0,
      right: 0,
      textAlign: 'center',
      fontSize: FontSize.f7,
      fontWeight: FontWeight.heavy,
      color: p.text,
    },
    conceptBars: { gap: Space.s20, paddingVertical: Space.s30, paddingHorizontal: Space.s10 },
    bigStat: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: Space.s9,
      marginVertical: Space.s18,
    },
    bigStatValue: { fontSize: FontSize.f32, color: p.text, fontWeight: FontWeight.black },
    bigStatCaption: { fontSize: FontSize.f10, color: p.muted },

    /* ===================== heatmap ===================== */
    xraySummary: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.s8, marginVertical: Space.s16 },
    xraySummaryTrack: Grid.columns(wide ? 4 : 2),
    xraySummaryMetric: { minHeight: 100, backgroundColor: p.surface2 },
    heatmap: { gap: compact ? Space.s4 : Space.s7 },
    heatmapRow: { flexDirection: 'row', alignItems: 'center', gap: compact ? Space.s4 : Space.s7 },
    heatmapRowLabel: { width: compact ? 70 : 100, fontSize: FontSize.f10, fontWeight: FontWeight.bold, color: p.text },
    heatmapColLabel: {
      flexGrow: 1,
      flexBasis: 0,
      textAlign: 'center',
      fontSize: compact ? FontSize.f7 : FontSize.f9,
      color: p.muted,
    },
    heatmapCell: {
      flexGrow: 1,
      flexBasis: 0,
      borderRadius: Radius.sm + 1,
      minHeight: 37,
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
    },
    heatmapCellText: { fontSize: compact ? FontSize.f8 : FontSize.f10, fontWeight: FontWeight.heavy },
    tierMastered: { backgroundColor: p.successSoftBg },
    tierMasteredText: { color: p.successSoftText },
    tierDeveloping: { backgroundColor: p.warningSoftBg },
    tierDevelopingText: { color: p.warningSoftText },
    tierGap: { backgroundColor: p.dangerSoftBg },
    tierGapText: { color: p.dangerSoftText },
    tierReview: { backgroundColor: p.neutralBg },
    tierReviewText: { color: p.neutralText },
    heatLegend: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Space.s14,
      marginTop: Space.s13,
      justifyContent: 'flex-end',
    },
    heatLegendItem: { flexDirection: 'row', alignItems: 'center', gap: Space.s5 },
    heatLegendSwatch: { width: 8, height: 8, borderRadius: Radius.xs },
    heatLegendLabel: { fontSize: FontSize.f8, color: p.muted },

    /* ===================== steps, timeline, lists ===================== */
    stepList: { gap: Space.s7, marginVertical: Space.s18 },
    stepRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.s9,
      padding: Space.s8,
      backgroundColor: p.surface2,
      borderRadius: Radius.input,
    },
    stepIndex: {
      width: 25,
      height: 25,
      borderRadius: Radius.circle(25),
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: p.navyTintStrong,
    },
    stepIndexText: { color: p.navy, fontSize: FontSize.f10, fontWeight: FontWeight.heavy },
    stepTitle: { fontSize: FontSize.f11, color: p.text, fontWeight: FontWeight.bold },
    stepCaption: { fontSize: FontSize.f9, color: p.muted },
    timeline: { flexDirection: 'row', marginVertical: Space.s24, marginHorizontal: Space.s10 },
    // repeat(4,130px) inside a horizontal ScrollView at <=760.
    timelineStep: compact
      ? { flexGrow: 1, flexShrink: 0, flexBasis: 130, alignItems: 'center' }
      : { ...Grid.columns(4), alignItems: 'center' },
    timelineConnector: {
      position: 'absolute',
      height: 2,
      left: '-50%',
      right: '50%',
      top: 15,
      backgroundColor: p.border,
    },
    timelineConnectorDone: { backgroundColor: p.green },
    timelineDot: {
      width: 30,
      height: 30,
      borderRadius: Radius.circle(30),
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: p.surface2,
    },
    timelineDotDone: { backgroundColor: p.green },
    timelineDotDoneText: { color: p.onNavy },
    timelineDotCurrent: { backgroundColor: p.surface, boxShadow: ring(p.navyEdge, 4) },
    timelineDotCurrentText: { color: p.navy },
    timelineLabel: { fontSize: FontSize.f10, color: p.muted, marginTop: Space.s8, textAlign: 'center' },
    timelineCaption: { fontSize: FontSize.f8, color: p.muted, marginTop: Space.s8, textAlign: 'center' },
    issueList: { gap: 0 },
    issueRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.s10,
      paddingVertical: Space.s10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: p.border,
    },
    issueDot: { width: 8, height: 8, borderRadius: Radius.circle(8) },
    issueTitle: { fontSize: FontSize.f11, color: p.text, fontWeight: FontWeight.bold },
    issueCaption: { fontSize: FontSize.f9, color: p.muted, marginTop: Space.s3 },
    dotGood: { backgroundColor: p.green },
    dotMid: { backgroundColor: p.orange },
    dotRisk: { backgroundColor: p.red },
    checklist: { gap: 0 },
    checklistRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.s8, paddingVertical: Space.s9 },
    checklistBullet: { color: p.green, fontWeight: FontWeight.heavy }, // li::before "checkmark"
    checklistText: { fontSize: FontSize.f11, color: p.muted },
    /** `.check` - a checkbox label forced back onto one row. */
    check: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.s6,
    },
    checkText: { fontSize: FontSize.f11, fontWeight: FontWeight.regular, color: p.text },
    listItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.s10,
      paddingVertical: Space.s11,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: p.border,
    },
    listItemBody: { gap: Space.s4, flexShrink: 1, minWidth: 0 },
    listItemText: { fontSize: FontSize.f10, color: p.text },
    listItemCaption: { fontSize: FontSize.f8, color: p.muted },
    listItemAction: { color: p.navy, fontWeight: FontWeight.heavy, fontSize: FontSize.f10 },
    activityList: { gap: Space.s7, maxHeight: 400, marginVertical: Space.s12 },
    activityRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.s9,
      padding: Space.s10,
      backgroundColor: p.surface2,
      borderRadius: Radius.input,
    },
    activityIcon: { color: p.green },
    activityText: { fontSize: FontSize.f10, color: p.text },
    notification: {
      alignItems: 'flex-start',
      gap: Space.s9,
      padding: Space.s10,
      marginVertical: Space.s8,
      backgroundColor: p.surface2,
      borderRadius: Radius.input,
    },
    notificationCaption: { fontSize: FontSize.f10, color: p.muted },

    /* ===================== modal ===================== */
    modalBackdrop: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: p.scrim,
      alignItems: 'center',
      justifyContent: 'center',
      padding: Space.s18,
      zIndex: 50,
    },
    modal: {
      width: '100%',
      maxWidth: Layout.modalMaxWidth,
      backgroundColor: p.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      borderRadius: Radius.modal,
      padding: compact ? Space.s18 : Space.s28,
      boxShadow: shadow(alpha(p.black, 0.28), 30, 80),
    },
    functionalModal: { maxHeight: 850 }, // min(88vh, 850px) - clamp against window height
    modalTitle: {
      fontSize: FontSize.f24,
      color: p.text,
      marginTop: Space.s6,
      marginBottom: Space.s20,
      fontWeight: FontWeight.bold,
    },
    modalCopy: {
      fontSize: FontSize.f12,
      color: p.muted,
      lineHeight: FontSize.f12 * LineHeight.loose,
    },
    modalClose: {
      position: 'absolute',
      right: Space.s16,
      top: Space.s14,
      width: 32,
      height: 32,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      backgroundColor: p.surface2,
      borderRadius: Radius.circle(32),
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
    },
    modalCloseText: { fontSize: FontSize.f18, color: p.text },

    /* ===================== forms ===================== */
    label: { gap: Space.s6, marginVertical: Space.s12 },
    labelText: { fontSize: FontSize.f10, fontWeight: FontWeight.bold, color: p.text },
    input: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      backgroundColor: p.field,
      color: p.text,
      borderRadius: Radius.input,
      padding: Space.s10,
    },
    compactInput: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      backgroundColor: p.field,
      color: p.text,
      borderRadius: Radius.input,
      padding: Space.s8,
    },
    textarea: { minHeight: 100, textAlignVertical: 'top' },
    formGrid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Space.s12 },
    formGridCell: compact ? { width: '100%' } : Grid.columns(2),
    formGridCellFull: { width: '100%', flexBasis: '100%' },
    formError: {
      backgroundColor: p.dangerBg,
      paddingVertical: Space.s10,
      paddingHorizontal: Space.s12,
      borderRadius: Radius.input,
    },
    formErrorText: { color: p.dangerText, fontSize: FontSize.f10, fontWeight: FontWeight.bold },
    validationSummary: {
      marginTop: Space.s14,
      paddingVertical: Space.s14,
      paddingHorizontal: Space.s16,
      borderRadius: Radius.xl,
      backgroundColor: p.dangerBg,
    },
    validationSummaryText: { color: p.dangerText },
    /** `.file-input` is a visually hidden <input type=file>; RN uses a picker. */
    fileInput: { position: 'absolute', width: 1, height: 1, opacity: 0 },

    /* ===================== upload ===================== */
    dropzone: {
      minHeight: 210,
      borderWidth: 1.5,
      borderStyle: 'dashed',
      borderColor: p.dropzoneBorder,
      backgroundColor: p.surface2,
      borderRadius: Radius.panel,
      alignItems: 'center',
      justifyContent: 'center',
      gap: Space.s8,
      cursor: 'pointer',
    },
    dropzoneUploaded: { borderColor: p.green },
    dropzoneIcon: { fontSize: FontSize.f34, color: p.navy },
    dropzoneIconUploaded: { color: p.green },
    dropzoneTitle: { fontSize: FontSize.f14, color: p.text, fontWeight: FontWeight.bold },
    dropzoneCaption: { color: p.muted, fontSize: FontSize.f10, maxWidth: '90%', textAlign: 'center' },
    uploadProgress: {
      marginTop: Space.s12,
      height: 40,
      backgroundColor: p.surface2,
      borderRadius: Radius.input,
      overflow: 'hidden',
      justifyContent: 'center',
      paddingHorizontal: Space.s12,
    },
    uploadProgressFill: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: 0,
      backgroundColor: p.navyEdge,
    },
    uploadProgressLabel: { fontSize: FontSize.f10, color: p.text },
    uploadList: { gap: Space.s8, marginVertical: Space.s14, maxHeight: 220 },
    uploadRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.s10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      borderRadius: Radius.md,
      padding: Space.s8,
    },
    uploadRowBody: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
    uploadRowTitle: { fontSize: FontSize.f10, color: p.text },
    uploadRowCaption: { fontSize: FontSize.f8, color: p.muted, marginVertical: Space.s4 },
    uploadRowRemove: { color: p.muted, fontSize: FontSize.f20 },
    fileIcon: {
      width: compact ? 40 : 48,
      height: compact ? 40 : 48,
      borderRadius: Radius.sm + 1,
      backgroundColor: p.surface2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    fileIconText: { fontSize: FontSize.f9, fontWeight: FontWeight.heavy, color: p.navy },
    uploadedFilesGrid: { gap: Space.s9 },
    uploadedFilesRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: Space.s12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      borderRadius: Radius.xl,
      padding: Space.s11,
    },
    uploadedFilesBody: { flexGrow: 1, flexShrink: 1, minWidth: compact ? 0 : 180 },
    uploadedFilesTitle: { fontSize: FontSize.f11, color: p.text, fontWeight: FontWeight.bold },
    uploadedFilesCaption: { fontSize: FontSize.f9, color: p.muted, marginTop: Space.s4 },
    gradeFilePicker: { gap: Space.s8, marginVertical: Space.s14 },
    gradeFileOption: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.s10,
      padding: Space.s10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      borderRadius: Radius.lg,
      cursor: 'pointer',
    },
    gradeFileOptionSelected: { borderColor: p.orange, backgroundColor: mix(p.orange, p.surface, 0.08) },
    gradeFileTitle: { fontSize: FontSize.f10, color: p.text },
    gradeFileCaption: { fontSize: FontSize.f8, color: p.muted, marginTop: Space.s4 },
    gradeFileFlag: { fontSize: FontSize.f8, color: p.green, fontWeight: FontWeight.heavy },

    /* ===================== toast ===================== */
    toast: {
      position: 'absolute',
      right: compact ? Space.s15 : Space.s24,
      left: compact ? Space.s15 : undefined,
      bottom: compact ? Space.s76 + Space.s2 : Space.s24,
      zIndex: 60,
      backgroundColor: p.navyDeep,
      borderRadius: Radius.xl,
      paddingVertical: Space.s13,
      paddingHorizontal: Space.s17,
      boxShadow: shadow(alpha(p.black, 0.24), 15, 40),
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.s9,
    },
    toastText: { color: p.onNavy, fontSize: FontSize.f11 },
    toastHighlight: { color: p.successAccent },
    toastWarning: { backgroundColor: shade(p.orange, 0.545) },
    toastError: { backgroundColor: shade(p.red, 0.3) },
    syncIndicator: { color: p.muted, fontSize: FontSize.f10, fontWeight: FontWeight.bold },
    syncIndicatorSynced: { color: p.green },
    syncIndicatorOffline: { color: p.orange },

    /* ===================== sign-in ===================== */
    loginPage: { flex: 1, flexDirection: compact ? 'column' : 'row', backgroundColor: compact ? p.surface : p.bg },
    loginStory: {
      flexGrow: compact ? 0 : 1.15,
      flexBasis: 0,
      backgroundColor: p.navyInk, // radial + linear gradient collapsed - see CAVEATS
      alignItems: compact ? 'stretch' : 'center',
      justifyContent: 'center',
      paddingHorizontal: compact ? Space.s24 : Space.s72,
      paddingTop: compact ? Space.s42 : Space.s72,
      paddingBottom: compact ? Space.s38 : Space.s72,
    },
    loginStoryInner: { maxWidth: compact ? undefined : 650, width: '100%' },
    loginLogo: { display: compact ? 'none' : 'flex', width: 168, marginBottom: Space.s64 },
    loginTitle: {
      color: p.onNavy,
      fontSize: compact ? FontSize.f37 : FontSize.f72,
      lineHeight: (compact ? FontSize.f37 : FontSize.f72) * LineHeight.tight,
      letterSpacing: letterSpacing(compact ? FontSize.f37 : FontSize.f72, Tracking.display),
      marginTop: Space.s12,
      marginBottom: compact ? Space.s16 : Space.s24,
      fontWeight: FontWeight.bold,
    },
    loginLead: {
      fontSize: compact ? FontSize.f14 : FontSize.f17,
      lineHeight: (compact ? FontSize.f14 : FontSize.f17) * LineHeight.relaxed,
      color: p.onNavyLead,
      maxWidth: 570,
    },
    loginProof: {
      flexDirection: compact ? 'column' : 'row',
      gap: Space.s14,
      marginTop: compact ? Space.s32 : Space.s64,
    },
    loginProofCard: {
      flexGrow: 1,
      flexBasis: 0,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.onNavyLine,
      backgroundColor: p.onNavyFill,
      borderRadius: Radius.card - 2,
      padding: compact ? Space.s13 : Space.s18,
      flexDirection: compact ? 'row' : 'column',
      alignItems: compact ? 'center' : 'stretch',
      gap: compact ? Space.s10 : 0,
    },
    loginProofBadge: {
      color: p.amberPale,
      fontSize: FontSize.f10,
      fontWeight: FontWeight.heavy,
      marginBottom: compact ? 0 : Space.s30,
    },
    loginProofBody: { gap: Space.s7, flexShrink: 1 },
    loginProofTitle: { color: p.onNavy, fontSize: FontSize.f12, fontWeight: FontWeight.bold },
    loginProofCaption: {
      color: p.onNavyFaint,
      fontSize: FontSize.f10,
      lineHeight: FontSize.f10 * LineHeight.body,
    },
    loginPanel: {
      flexGrow: compact ? 0 : 0.85,
      flexBasis: 0,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: compact ? Space.s24 : Space.s52,
      paddingTop: compact ? Space.s38 : Space.s52,
      paddingBottom: compact ? Space.s48 : Space.s52,
      backgroundColor: p.surface, // linear-gradient(#fff, #f7f7f5) collapsed
    },
    loginCard: { width: '100%', maxWidth: Layout.loginCardWidth },
    loginMobileLogo: { display: compact ? 'flex' : 'none', width: 145, marginBottom: Space.s44 },
    loginCardTitle: {
      fontSize: FontSize.f32,
      letterSpacing: letterSpacing(FontSize.f32, Tracking.heading),
      color: p.text,
      marginTop: Space.s9,
      marginBottom: Space.s12,
      fontWeight: FontWeight.bold,
    },
    loginCardLead: {
      color: p.muted,
      fontSize: FontSize.f13,
      lineHeight: FontSize.f13 * LineHeight.body,
      marginBottom: Space.s26,
    },
    signinPrimary: {
      height: 52,
      borderRadius: Radius.xxl - 1,
      backgroundColor: p.navy,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Space.s10,
      boxShadow: shadow(alpha(p.navy, 0.22), 12, 28),
    },
    signinPrimaryHover: { backgroundColor: tint(p.navy, 0.1) },
    signinPrimaryText: { color: p.onNavy, fontSize: FontSize.f13, fontWeight: FontWeight.heavy },
    signinPrimaryIcon: { color: p.orange },
    loginDivider: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.s10,
      marginTop: Space.s28,
      marginBottom: Space.s16,
    },
    loginDividerRule: { flex: 1, height: 1, backgroundColor: p.border }, // ::before / ::after
    loginDividerText: { color: p.inkFaint, fontSize: FontSize.f9 },
    providerGrid: { flexDirection: compact ? 'column' : 'row', gap: Space.s8 },
    providerCard: {
      flexGrow: 1,
      flexBasis: 0,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      backgroundColor: p.surface,
      borderRadius: Radius.xl,
      minHeight: compact ? 52 : 82,
      flexDirection: compact ? 'row' : 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Space.s8,
    },
    providerCardHover: { borderColor: p.navy, boxShadow: shadow(alpha(p.navy, 0.12), 8, 20) },
    providerCardTitle: { fontSize: FontSize.f17, color: p.navy },
    providerCardCaption: { fontSize: FontSize.f8, color: p.muted, textAlign: 'center' },
    loginNote: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: Space.s7,
      marginTop: Space.s24,
      marginBottom: Space.s42,
    },
    loginNoteText: { color: p.muted, fontSize: FontSize.f9 },
    loginNoteDot: { color: p.green, fontSize: FontSize.f7 },
    loginFooter: {
      flexDirection: 'row',
      gap: Space.s14,
      alignItems: 'center',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: p.border,
      paddingTop: Space.s17,
    },
    loginFooterText: { color: p.inkFaint, fontSize: FontSize.f9 },
    loginFooterLink: { color: p.muted, fontSize: FontSize.f9 },
    loginFooterSpacer: { marginLeft: 'auto' },

    /* ===================== legal pages ===================== */
    legalPage: {
      flex: 1,
      width: '100%',
      maxWidth: Layout.legalMaxWidth,
      marginHorizontal: 'auto',
      paddingHorizontal: compact ? Space.s22 : Space.s30,
      paddingVertical: compact ? Space.s38 : Space.s70,
    },
    legalLogo: { width: 160, marginVertical: Space.s48 },
    legalBack: { color: p.navy, fontWeight: FontWeight.bold },
    legalTitle: {
      fontSize: compact ? FontSize.f34 : FontSize.f44,
      letterSpacing: letterSpacing(compact ? FontSize.f34 : FontSize.f44, Tracking.heading),
      lineHeight: (compact ? FontSize.f34 : FontSize.f44) * LineHeight.snug,
      color: p.text,
      fontWeight: FontWeight.bold,
    },
    legalHeading: { marginTop: Space.s36, fontSize: FontSize.f18, color: p.text, fontWeight: FontWeight.bold },
    legalBody: { color: p.inkMuted, lineHeight: FontSize.f14 * LineHeight.loose, fontSize: FontSize.f14 },
    legalAction: { alignSelf: 'flex-start', marginTop: Space.s30 },

    /* ===================== demo auth ===================== */
    appLoading: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: Space.s20,
      backgroundColor: p.bg,
    },
    appLoadingLogo: { width: 180 },
    // .demo-auth is the only place globals.css branches at 900 and 560, so this
    // block uses `demoCompact` / `mini` rather than the shell's `compact`.
    demoAuth: { flex: 1, flexDirection: demoCompact ? 'column' : 'row', backgroundColor: p.bg },
    demoAuthStory: {
      flexGrow: demoCompact ? 0 : 1.05,
      flexBasis: 0,
      justifyContent: 'center',
      paddingVertical: demoCompact ? Space.s44 : Space.s70,
      paddingHorizontal: demoCompact ? Space.s28 : Space.s110,
      backgroundColor: p.navyInk,
    },
    demoAuthLogo: { width: demoCompact ? 130 : 158, marginBottom: demoCompact ? Space.s36 : Space.s64 },
    demoAuthTitle: {
      color: p.onNavy,
      fontSize: mini ? FontSize.f34 : demoCompact ? FontSize.f42 : FontSize.f68,
      lineHeight: (mini ? FontSize.f34 : demoCompact ? FontSize.f42 : FontSize.f68) * LineHeight.tight,
      letterSpacing: letterSpacing(
        mini ? FontSize.f34 : demoCompact ? FontSize.f42 : FontSize.f68,
        Tracking.display,
      ),
      marginTop: Space.s12,
      marginBottom: Space.s24,
      fontWeight: FontWeight.bold,
    },
    demoAuthLead: {
      maxWidth: 620,
      color: p.onNavyLead,
      fontSize: mini ? FontSize.f13 : FontSize.f16,
      lineHeight: (mini ? FontSize.f13 : FontSize.f16) * LineHeight.loose,
    },
    // `.demo-auth-story ol` is `margin:28px 0 22px` at <=900 and hidden at <=560.
    demoAuthSteps: mini
      ? { display: 'none' }
      : {
          gap: Space.s12,
          maxWidth: 560,
          marginTop: demoCompact ? Space.s28 : Space.s42,
          marginBottom: demoCompact ? Space.s22 : Space.s34,
        },
    demoAuthStep: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.s13,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.onNavyLine,
      backgroundColor: p.onNavyFill,
      borderRadius: Radius.xxl,
      paddingVertical: Space.s13,
      paddingHorizontal: Space.s15,
    },
    demoAuthStepIndex: {
      width: 28,
      height: 28,
      borderRadius: Radius.circle(28),
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: p.orange,
    },
    demoAuthStepIndexText: { color: p.navyInk, fontSize: FontSize.f10, fontWeight: FontWeight.bold },
    demoAuthStepLabel: { color: p.onNavy, fontSize: FontSize.f12, fontWeight: FontWeight.bold },
    demoWarning: {
      maxWidth: 560,
      gap: Space.s5,
      paddingVertical: Space.s14,
      paddingHorizontal: Space.s16,
      borderLeftWidth: 3,
      borderLeftColor: p.orange,
      backgroundColor: alpha(shade(p.navy, 0.8), 0.2),
    },
    demoWarningTitle: {
      fontSize: FontSize.f10,
      textTransform: 'uppercase',
      letterSpacing: letterSpacing(FontSize.f10, Tracking.label),
      color: p.amberPale,
      fontWeight: FontWeight.bold,
    },
    demoWarningText: { fontSize: FontSize.f10, color: p.onNavyLead, lineHeight: FontSize.f10 * LineHeight.body },
    demoAuthPanel: {
      flexGrow: demoCompact ? 0 : 0.95,
      flexBasis: 0,
      alignItems: 'center',
      justifyContent: 'center',
      // 48px, then `40px 24px 60px` at <=900, then `32px 18px 48px` at <=560.
      paddingHorizontal: mini ? Space.s18 : demoCompact ? Space.s24 : Space.s48,
      paddingTop: mini ? Space.s32 : demoCompact ? Space.s40 : Space.s48,
      paddingBottom: mini ? Space.s48 : demoCompact ? Space.s60 : Space.s48,
      backgroundColor: p.surface,
    },
    demoAuthCard: { width: '100%', maxWidth: Layout.demoCardWidth },
    demoAuthCardTitle: {
      fontSize: mini ? FontSize.f28 : FontSize.f34,
      letterSpacing: letterSpacing(mini ? FontSize.f28 : FontSize.f34, Tracking.heading),
      color: p.text,
      marginTop: Space.s9,
      marginBottom: Space.s10,
      fontWeight: FontWeight.bold,
    },
    demoAuthCardLead: {
      color: p.muted,
      fontSize: FontSize.f12,
      lineHeight: FontSize.f12 * LineHeight.relaxed,
      marginBottom: Space.s24,
    },
    demoAuthLabel: { gap: Space.s7, marginVertical: Space.s13 },
    demoAuthLabelText: { color: p.inkMuted, fontSize: FontSize.f10, fontWeight: FontWeight.heavy },
    demoAuthInput: {
      height: 46,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      borderRadius: Radius.lg,
      paddingHorizontal: Space.s13,
      backgroundColor: p.surface,
      color: p.text,
    },
    teacherStart: {
      width: '100%',
      minHeight: 76,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.s12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.navy,
      backgroundColor: p.navy,
      borderRadius: Radius.xxl,
      padding: Space.s12,
      boxShadow: shadow(alpha(p.navy, 0.2), 12, 28),
      cursor: 'pointer',
    },
    teacherStartBadge: {
      width: 40,
      height: 40,
      borderRadius: Radius.lg,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: p.orange,
    },
    teacherStartBadgeText: { color: p.navyInk, fontWeight: FontWeight.black },
    teacherStartTitle: { color: p.onNavy, fontSize: FontSize.f11, fontWeight: FontWeight.bold },
    teacherStartCaption: { color: p.onNavyLead, fontSize: FontSize.f9 },
    demoDivider: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.s10,
      marginTop: Space.s24,
      marginBottom: Space.s13,
    },
    demoDividerRule: { flex: 1, height: 1, backgroundColor: p.border },
    demoDividerText: { color: p.inkFaint, fontSize: FontSize.f9 },
    demoAccountList: { gap: Space.s8 },
    demoAccountButton: {
      width: '100%',
      minHeight: 65,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.s12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      backgroundColor: p.surface,
      borderRadius: Radius.xxl,
      padding: Space.s12,
      cursor: 'pointer',
    },
    demoAccountButtonHover: { borderColor: p.navy, transform: [{ translateY: -1 }] },
    demoAccountBadge: {
      width: 40,
      height: 40,
      borderRadius: Radius.lg,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: p.navyTint,
    },
    demoAccountBadgeText: { color: p.navy, fontWeight: FontWeight.black },
    demoAccountTitle: { fontSize: FontSize.f11, color: p.text, fontWeight: FontWeight.bold },
    demoAccountCaption: { fontSize: FontSize.f9, color: p.inkFaint },
    demoRoleBadge: {
      display: mini ? 'none' : 'flex', // @media(max-width:560px)
      height: 30,
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: Radius.pill,
      paddingHorizontal: Space.s10,
      backgroundColor: p.surface2,
    },
    demoRoleBadgeText: { color: p.muted, fontSize: FontSize.f9, fontWeight: FontWeight.heavy },
    demoSignout: { minWidth: undefined },
    demoSignoutText: { fontSize: FontSize.f9, fontWeight: FontWeight.heavy, color: p.text },

    /* ===================== workflow: journey, pipeline, admin ===================== */
    journey: compact
      ? { flexDirection: 'row', gap: Space.s8 } // horizontal ScrollView
      : { flexDirection: 'row', flexWrap: 'wrap', gap: Space.s8 },
    journeyTrack: compact ? { minWidth: 155 } : Grid.columns(wide ? 5 : 3),
    journeyStep: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      borderRadius: Radius.xl,
      backgroundColor: p.surface,
      paddingVertical: Space.s12,
      paddingHorizontal: Space.s8,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.s8,
      cursor: 'pointer',
    },
    journeyStepCurrent: { borderColor: p.orange, boxShadow: ring(alpha(p.orange, 0.16), 2) },
    journeyStepIcon: {
      width: 28,
      height: 28,
      borderRadius: Radius.circle(28),
      backgroundColor: p.surface2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    journeyStepIconDone: { backgroundColor: p.green },
    journeyStepIconDoneText: { color: p.onNavy },
    journeyStepTitle: { fontSize: FontSize.f10, color: p.text, fontWeight: FontWeight.bold },
    journeyStepCaption: { fontSize: FontSize.f8, color: p.muted },
    pipeline: { gap: Space.s6, marginVertical: Space.s15 },
    pipelineRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.s8,
      padding: Space.s8,
      backgroundColor: p.surface2,
      borderRadius: Radius.input,
    },
    pipelineIcon: {
      width: 24,
      height: 24,
      borderRadius: Radius.circle(24),
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: p.surface,
    },
    pipelineIconDone: { backgroundColor: p.green },
    pipelineIconDoneText: { color: p.onNavy },
    pipelineTitle: { fontSize: FontSize.f10, color: p.text, fontWeight: FontWeight.bold },
    pipelineCaption: { fontSize: FontSize.f8, color: p.muted },
    impactBox: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      backgroundColor: p.surface2,
      borderRadius: Radius.lg,
      padding: Space.s13,
      marginVertical: Space.s12,
    },
    impactBoxTitle: { fontSize: FontSize.f10, color: p.text, fontWeight: FontWeight.bold },
    impactBoxCaption: { fontSize: FontSize.f10, color: p.muted, marginTop: Space.s6 },
    resourceDraft: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      backgroundColor: p.surface2,
      borderRadius: Radius.lg,
      padding: Space.s13,
      marginVertical: Space.s12,
    },
    resourceDraftText: { fontSize: FontSize.f10, color: p.muted, lineHeight: FontSize.f10 * LineHeight.relaxed },
    secureLink: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.s8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      backgroundColor: p.surface2,
      borderRadius: Radius.lg,
      padding: Space.s13,
      marginVertical: Space.s12,
    },
    secureLinkCode: { flex: 1, fontSize: FontSize.f10, color: p.text },
    secureLinkButton: {
      backgroundColor: p.navy,
      borderRadius: Radius.sm + 1,
      padding: Space.s7,
    },
    secureLinkButtonText: { color: p.onNavy, fontSize: FontSize.f10, fontWeight: FontWeight.bold },
    adminActions: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.s10 },
    adminActionsTrack: compact ? { width: '100%' } : Grid.columns(wide ? 3 : 2),
    adminAction: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      backgroundColor: p.surface,
      borderRadius: Radius.xl,
      padding: Space.s15,
      gap: Space.s7,
      cursor: 'pointer',
    },
    adminActionHover: { borderColor: p.navy, boxShadow: cardShadow },
    adminActionTitle: { color: p.text, fontWeight: FontWeight.heavy },
    adminActionCaption: { fontSize: FontSize.f9, color: p.muted, fontWeight: FontWeight.regular },

    /* ===================== users ===================== */
    userTable: { gap: 0 },
    userRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: Space.s10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: p.border,
      paddingVertical: Space.s11,
    },
    userRowAvatar: { width: compact ? 38 : 40, flexGrow: 0, flexShrink: 0 },
    userRowIdentity: { flexGrow: 1.5, flexShrink: 1, flexBasis: compact ? 0 : 170, minWidth: compact ? 0 : 170 },
    userRowCell: { flexGrow: 0.7, flexShrink: 1, flexBasis: 0, minWidth: 0, display: compact ? 'none' : 'flex' },
    userRowActions: compact
      ? { width: '100%', flexBasis: '100%', justifyContent: 'flex-start' }
      : { flexGrow: 1.5, flexShrink: 1, flexBasis: 0, minWidth: 0 },
    userRowName: { fontSize: FontSize.f10, color: p.text, fontWeight: FontWeight.bold },
    userRowCaption: { fontSize: FontSize.f8, color: p.muted, marginTop: Space.s4 },
    avatar: {
      width: 34,
      height: 34,
      borderRadius: Radius.circle(34),
      backgroundColor: p.navyEdge,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { color: p.navy, fontSize: FontSize.f9, fontWeight: FontWeight.heavy },
    avatarStack: { flexDirection: 'row', marginVertical: Space.s18 },
    avatarStacked: {
      width: 38,
      height: 38,
      borderRadius: Radius.circle(38),
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: p.navyEdge,
      borderWidth: 3,
      borderColor: p.surface,
      marginRight: -7,
    },
    studentRow: { width: '100%', backgroundColor: p.surface, cursor: 'pointer' },
    studentRowHover: { backgroundColor: p.surface2 },

    /* ===================== settings and achievements ===================== */
    settingsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.s12 },
    settingsTrack: compact ? { width: '100%' } : Grid.columns(wide ? 3 : 2),
    settingsCard: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      backgroundColor: p.surface,
      borderRadius: Radius.xxl,
      padding: Space.s18,
      gap: Space.s8,
      cursor: 'pointer',
    },
    settingsCardHover: { borderColor: p.navy, boxShadow: cardShadow, transform: [{ translateY: -2 }] },
    settingsCardTitle: { fontSize: FontSize.f12, color: p.text, fontWeight: FontWeight.bold },
    settingsCardCaption: { fontSize: FontSize.f9, color: p.muted, lineHeight: FontSize.f9 * LineHeight.body },
    settingsCardAction: { fontSize: FontSize.f9, color: p.navy, fontWeight: FontWeight.heavy },
    achievementGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.s12, marginVertical: Space.s16 },
    achievementTrack: compact ? { width: '100%' } : Grid.columns(wide ? 5 : 3),
    achievementIcon: {
      width: 42,
      height: 42,
      borderRadius: Radius.circle(42),
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: p.warningSoftBg,
    },
    achievementIconText: { color: p.warningSoftText, fontSize: FontSize.f18 },

    /* ===================== decisions, gaps, templates ===================== */
    decisionCard: {
      flexDirection: compact ? 'column' : 'row',
      alignItems: compact ? 'stretch' : 'center',
      justifyContent: 'space-between',
      gap: Space.s22,
      borderLeftWidth: 5,
      borderLeftColor: p.orange,
    },
    decisionCardBody: { maxWidth: 660 },
    gapFunnel: { gap: Space.s8, marginVertical: Space.s17 },
    gapFunnelRow: {
      overflow: 'hidden',
      borderRadius: Radius.chip,
      backgroundColor: p.surface2,
      padding: Space.s9,
      justifyContent: 'center',
    },
    gapFunnelFill: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: 0,
      backgroundColor: alpha(p.green, 0.18),
    },
    gapFunnelFillCritical: { backgroundColor: alpha(p.red, 0.2) },
    gapFunnelLabel: { fontSize: FontSize.f9, fontWeight: FontWeight.heavy, color: p.text },
    gapClusters: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.s9, marginTop: Space.s17, marginBottom: Space.s20 },
    gapClusterTrack: Grid.autoFit(190),
    clusterHeading: {
      width: '100%',
      flexBasis: '100%',
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    clusterHeadingTitle: { fontSize: FontSize.f12, color: p.text, fontWeight: FontWeight.bold },
    clusterHeadingCaption: { fontSize: FontSize.f9, color: p.muted },
    gapCluster: {
      alignItems: 'flex-start',
      gap: Space.s5,
      padding: Space.s12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      borderLeftWidth: 4,
      borderLeftColor: p.orange,
      borderRadius: Radius.lg,
      backgroundColor: p.surface2,
      cursor: 'pointer',
    },
    gapClusterKicker: {
      fontSize: FontSize.f8,
      textTransform: 'uppercase',
      letterSpacing: letterSpacing(FontSize.f8, 0.09),
      color: p.muted,
    },
    gapClusterTitle: { fontSize: FontSize.f11, color: p.text, fontWeight: FontWeight.bold },
    gapClusterBody: { fontSize: FontSize.f9, color: p.muted, lineHeight: FontSize.f9 * LineHeight.base },
    studyPlan: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.s9, marginVertical: Space.s12 },
    studyPlanTrack: compact ? { width: '100%' } : Grid.columns(2),
    studyPlanCard: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      borderRadius: Radius.lg,
      padding: Space.s12,
      backgroundColor: p.surface2,
    },
    templatePicker: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.s8, marginVertical: Space.s12 },
    templateTrack: Grid.columns(compact ? 2 : 4),
    templateOption: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      backgroundColor: p.surface,
      borderRadius: Radius.md,
      padding: Space.s10,
      cursor: 'pointer',
    },
    templateOptionActive: { borderColor: p.orange, boxShadow: ring(alpha(p.orange, 0.18), 2) },
    templateOptionTitle: { fontSize: FontSize.f9, color: p.text, fontWeight: FontWeight.bold },
    templateOptionCaption: { fontSize: FontSize.f7, color: p.muted, marginTop: Space.s4 },
    worksheetStats: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.s7, marginVertical: Space.s12 },
    worksheetStat: {
      ...Grid.columns(3),
      backgroundColor: p.surface2,
      borderRadius: Radius.chip,
      padding: Space.s8,
    },
    worksheetStatLabel: { fontSize: FontSize.f8, color: p.muted },
    worksheetStatValue: { fontSize: FontSize.f14, color: p.text },
    gradingResults: {
      gap: Space.s7,
      backgroundColor: p.surface2,
      padding: Space.s13,
      borderRadius: Radius.lg,
      marginVertical: Space.s12,
    },
    gradingResultRow: {
      fontSize: FontSize.f9,
      color: p.text,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: p.border,
      paddingTop: Space.s7,
    },

    /* ===================== branded documents ===================== */
    evidenceEntry: {
      flexDirection: compact ? 'column' : 'row',
      alignItems: compact ? 'stretch' : 'center',
      justifyContent: 'space-between',
      gap: Space.s24,
      backgroundColor: mix(p.navy, p.surface, 0.07),
      borderTopWidth: 4,
      borderTopColor: p.orange,
    },
    evidenceEntryBody: { maxWidth: 680 },
    evidenceRoleList: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: compact ? 'flex-start' : 'flex-end',
      gap: Space.s7,
    },
    evidenceRoleTag: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      borderRadius: Radius.pill,
      backgroundColor: p.surface2,
      paddingVertical: Space.s6,
      paddingHorizontal: Space.s9,
    },
    evidenceRoleTagText: { fontSize: FontSize.f8, color: p.text, fontWeight: FontWeight.bold },
    brandedDocument: {
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: mix(p.navy, p.border, 0.25),
      borderRadius: Radius.card - 2,
      backgroundColor: p.surface,
      padding: Space.s15,
      marginVertical: Space.s13,
      boxShadow: shadow(alpha(p.navyInk, 0.09), 16, 44),
    },
    brandDocumentHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.s14,
      marginTop: -Space.s15,
      marginHorizontal: -Space.s15,
      marginBottom: Space.s15,
      paddingVertical: Space.s14,
      paddingHorizontal: Space.s16,
      backgroundColor: p.navyDeep, // linear-gradient(120deg,#112c56,#23497d)
      borderBottomWidth: 4,
      borderBottomColor: p.orange,
    },
    brandDocumentLogo: { width: 92, maxHeight: 40 }, // filter: brightness(0) invert(1) -> tintColor
    brandDocumentKicker: {
      color: p.onNavyFaint,
      fontSize: FontSize.f8,
      textTransform: 'uppercase',
      letterSpacing: letterSpacing(FontSize.f8, Tracking.eyebrowWide),
      fontWeight: FontWeight.heavy,
    },
    brandDocumentTitle: { color: p.onNavy, marginVertical: Space.s3, fontSize: FontSize.f17, fontWeight: FontWeight.bold },
    brandDocumentMeta: { color: p.onNavyFaint, fontSize: FontSize.f8 },
    brandDocumentTag: {
      display: compact ? 'none' : 'flex',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.lineOnDark,
      borderRadius: Radius.pill,
      paddingVertical: Space.s6,
      paddingHorizontal: Space.s8,
    },
    brandDocumentTagText: { color: p.onNavy, fontSize: FontSize.f7 },
    sourceRibbon: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: Space.s6,
      marginTop: Space.s10,
      marginBottom: Space.s16,
      padding: Space.s9,
      borderRadius: Radius.md,
      backgroundColor: mix(p.orange, p.surface2, 0.08),
    },
    sourceRibbonText: { fontSize: FontSize.f8, color: p.text },
    sourceRibbonTag: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      borderRadius: Radius.pill,
      backgroundColor: p.surface2,
      paddingVertical: Space.s6,
      paddingHorizontal: Space.s9,
    },
    questionNumber: {
      position: 'absolute',
      left: Space.s11,
      top: Space.s10,
      width: 22,
      height: 22,
      borderRadius: Radius.circle(22),
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: p.navy,
    },
    questionNumberText: { color: p.onNavy, fontWeight: FontWeight.heavy, fontSize: FontSize.f10 },

    /* ===================== continuous review workspace ===================== */
    reviewTopActions: {
      flexDirection: wide ? 'row' : 'column',
      alignItems: wide ? 'center' : 'stretch',
      justifyContent: 'space-between',
      gap: Space.s18,
      marginBottom: Space.s14,
    },
    reviewStudentBar: {
      flexDirection: 'row',
      flexWrap: compact ? 'wrap' : 'nowrap',
      alignItems: 'center',
      gap: Space.s14,
      paddingVertical: Space.s7,
      paddingHorizontal: Space.s10,
      borderWidth: 1.5,
      borderColor: p.red,
      borderRadius: Radius.input,
    },
    reviewStudentBarCell: { alignItems: 'center', gap: Space.s1 },
    reviewStudentBarTitle: { fontSize: FontSize.f12, color: p.text, fontWeight: FontWeight.bold },
    reviewStudentBarCaption: { fontSize: FontSize.f8, color: p.muted },
    reviewStudentSelect: {
      minWidth: compact ? 0 : 150,
      width: compact ? '100%' : undefined,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      backgroundColor: p.surface,
      color: p.text,
      borderRadius: Radius.md,
      paddingVertical: Space.s6,
      paddingHorizontal: Space.s9,
      fontSize: FontSize.f11,
      fontWeight: FontWeight.heavy,
      textAlign: 'center',
    },
    reviewStudentDetails: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Space.s16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      backgroundColor: p.surface,
      borderRadius: Radius.input,
      paddingVertical: Space.s14,
      paddingHorizontal: Space.s16,
      marginBottom: Space.s16,
      boxShadow: shadow(alpha(p.navyInk, 0.04), 2, 7),
    },
    // 1.1fr .65fr .75fr 1.2fr 1.35fr, collapsing to repeat(3,1fr) at <=1050 and
    // 1fr 1fr at <=760. Above 1050 the five cells are one non-wrapping line
    // (`Grid.track`): five 16px-gap columns need a ~770px container before a
    // percentage basis is safe, and this box is ~713px at a 1051px window.
    // The five weights are averaged to equal tracks, as they already were.
    reviewStudentDetailsCell: wide
      ? { gap: Space.s5, ...Grid.track(1) }
      : { gap: Space.s5, ...Grid.columns(compact ? 2 : 3) },
    reviewStudentDetailsLabel: { fontSize: FontSize.f8, color: p.muted },
    reviewStudentDetailsValue: { fontSize: FontSize.f10, color: p.text, fontWeight: FontWeight.bold },
    reviewSummary: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.s10, marginBottom: Space.s18 },
    reviewSummaryTrack: Grid.columns(wide ? 4 : 2),
    reviewSummaryCard: {
      backgroundColor: p.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      borderRadius: Radius.xxl,
      padding: Space.s14,
      gap: Space.s6,
    },
    reviewSummaryLabel: { color: p.muted, fontSize: FontSize.f10, fontWeight: FontWeight.bold },
    reviewSummaryValue: { fontSize: FontSize.f19, color: p.text, fontWeight: FontWeight.bold },
    reviewSummaryCompact: {
      width: wide ? Layout.summaryCompactWidth : '100%',
      alignSelf: wide ? 'flex-end' : 'stretch',
      marginBottom: Space.s14,
      padding: Space.s15,
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: Space.s12,
    },
    reviewSummaryCompactTitle: {
      width: '100%',
      color: p.text,
      textTransform: 'none',
      letterSpacing: 0,
      fontSize: FontSize.f10,
      fontWeight: FontWeight.heavy,
    },
    reviewSummaryCompactBody: { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: Space.s10 },
    reviewSummaryCompactRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Space.s8 },
    reviewSummaryCompactLabel: { fontSize: FontSize.f8, color: p.muted },
    reviewSummaryCompactValue: { fontSize: FontSize.f8, color: p.text },
    reviewScoreRing: {
      width: compact ? 70 : 70,
      height: 70,
      borderRadius: Radius.circle(70),
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: p.surface, // conic-gradient needs SVG - see CAVEATS
      borderWidth: 6,
      borderColor: p.navyEdge,
    },
    reviewScoreRingValue: { fontSize: FontSize.f18, color: p.text, fontWeight: FontWeight.bold },
    reviewScoreRingCaption: { fontSize: FontSize.f8, color: p.muted },
    continuousReviewLayout: {
      flexDirection: wide ? 'row' : 'column',
      alignItems: 'flex-start',
      gap: Space.s14,
    },
    continuousReviewWorkspace: {
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 0,
      minWidth: 0,
      alignSelf: 'stretch',
      gap: Space.s24,
      paddingLeft: compact ? 0 : Space.s30,
    },
    reviewPage: { padding: 0, backgroundColor: p.transparent },
    reviewPageHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: Space.s8 },
    reviewPageHeaderBadge: {
      backgroundColor: p.navyTint,
      borderRadius: Radius.sm,
      paddingVertical: Space.s6,
      paddingHorizontal: Space.s11,
    },
    reviewPageHeaderBadgeText: {
      color: p.navy,
      fontSize: FontSize.f10,
      fontWeight: FontWeight.heavy,
    },
    reviewPageFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: p.border,
      paddingTop: Space.s18,
      marginTop: Space.s18,
    },
    reviewPageFooterText: {
      color: p.muted,
      fontSize: FontSize.f10,
      fontWeight: FontWeight.heavy,
      letterSpacing: letterSpacing(FontSize.f10, Tracking.label),
    },
    reviewQuestionCard: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      borderRadius: Radius.sm + 1,
      overflow: 'hidden',
      marginVertical: Space.s8,
      backgroundColor: p.surface,
      boxShadow: shadow(alpha(p.navyInk, 0.04), 1, 4),
    },
    reviewQuestionCardReviewed: { borderColor: mix(p.green, p.border, 0.45) },
    reviewQuestionCardDot: {
      display: compact ? 'none' : 'flex',
      position: 'absolute',
      left: -30,
      top: 11,
      width: 19,
      height: 19,
      borderRadius: Radius.circle(19),
      backgroundColor: p.navy, // the review workspace violet maps to navy - see CAVEATS
    },
    reviewQuestionToggle: {
      backgroundColor: p.navyWash,
      paddingVertical: Space.s10,
      paddingHorizontal: Space.s12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.s10,
      cursor: 'pointer',
    },
    reviewQuestionToggleTitle: {
      flexGrow: 1,
      flexShrink: 1,
      minWidth: 0,
      fontSize: FontSize.f11,
      fontWeight: FontWeight.heavy,
      color: p.text,
    },
    reviewQuestionToggleMeta: { fontSize: FontSize.f11, color: p.text, fontWeight: FontWeight.bold },
    fiveStageReview: { gap: Space.s8, backgroundColor: p.surface, padding: Space.s8 },
    fiveStageSection: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      borderRadius: Radius.sm,
      overflow: 'hidden',
    },
    fiveStageHeader: { paddingVertical: Space.s9, paddingHorizontal: Space.s11 },
    fiveStageHeaderOne: { backgroundColor: mix(p.navy, p.surface, 0.08) }, // #eaf3ff
    fiveStageHeaderTwo: { backgroundColor: mix(p.green, p.surface, 0.1) }, // #edf9e8
    fiveStageHeaderThree: { backgroundColor: mix(p.orange, p.surface, 0.16) }, // #fff5d9
    fiveStageHeaderFour: { backgroundColor: mix(p.navy, p.surface, 0.12) }, // #f3eaff (violet)
    fiveStageHeaderFive: { backgroundColor: mix(p.red, p.surface, 0.1) }, // #ffe8ee
    fiveStageHeaderText: { color: p.text },
    fiveStageHeaderTextFive: { color: shade(p.red, 0.3) }, // #7e2436
    fiveStageBody: { marginHorizontal: Space.s11 },
    reviewSectionHead: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: Space.s15,
    },
    reviewSectionHeadTitle: { fontSize: FontSize.f15, color: p.text, marginVertical: Space.s8, fontWeight: FontWeight.bold },
    reviewSectionHeadPill: {
      backgroundColor: p.surface2,
      borderRadius: Radius.pill,
      paddingVertical: Space.s7,
      paddingHorizontal: Space.s10,
    },
    reviewSectionHeadPillText: { fontSize: FontSize.f11, color: p.text },
    aiMarkingPanel: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: p.border },
    aiMarkingBody: { marginHorizontal: Space.s18 },
    aiMarkingScore: { color: p.navy, fontSize: FontSize.f24, fontWeight: FontWeight.bold },
    aiMarkingText: { color: p.muted, fontSize: FontSize.f11, lineHeight: FontSize.f11 * LineHeight.body },
    teacherEditPanel: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: p.border },
    teacherEditBody: { marginHorizontal: Space.s11 },
    teacherEditLabel: { gap: Space.s6, marginTop: Space.s12 },
    teacherEditLabelText: { fontSize: FontSize.f10, fontWeight: FontWeight.heavy, color: p.text },
    teacherEditInput: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      backgroundColor: p.surface,
      color: p.text,
      borderRadius: Radius.input,
      padding: Space.s10,
    },
    teacherEditTextarea: { borderColor: mix(p.navy, p.surface, 0.45) }, // #6f9fff
    teacherMarkRow: {
      flexDirection: compact ? 'column' : 'row',
      justifyContent: 'space-between',
      alignItems: compact ? 'stretch' : 'flex-end',
      gap: Space.s15,
    },
    teacherMarkNote: { color: p.muted, fontSize: FontSize.f10 },
    teacherSaveRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: Space.s10,
    },
    teacherSaveRowText: { color: p.green, fontSize: FontSize.f10, fontWeight: FontWeight.heavy },
    /**
     * `.question-navigator` has two shapes.
     *
     * Above 1050 it is the sticky right rail of `.continuous-review-layout`:
     * `position:sticky; top:76px; max-height:calc(100vh - 100px); overflow:auto`
     * plus `margin-top:162px` from `@media(min-width:1051px)`.
     * At <=1050 it goes `position:static; max-height:none` and becomes a grid
     * of its own - `repeat(2,1fr)`, gap 12, with `> .eyebrow` spanning both
     * columns - collapsing to one column at <=760.
     *
     * `vh` and `position:sticky` have no RN equivalent: the max height is
     * resolved from the window (see `viewport`), and the rail's body must be a
     * ScrollView carrying `questionNavigatorScroll` /
     * `questionNavigatorScrollContent` to get `overflow:auto` back. On web,
     * sticky is restored with a fixed sibling or `stickyHeaderIndices`.
     */
    questionNavigator: {
      width: wide ? Layout.navigatorWidth : '100%',
      flexGrow: 0,
      flexShrink: 0,
      alignSelf: wide ? 'flex-start' : 'stretch',
      marginTop: wide ? Space.s120 + Space.s42 : 0, // 162px
      maxHeight: wide
        ? Math.max(320, viewport.height - Layout.navigatorViewportInset)
        : undefined,
      overflow: 'hidden',
      flexDirection: wide ? 'column' : 'row',
      flexWrap: wide ? 'nowrap' : 'wrap',
      gap: wide ? 0 : Space.s12,
      padding: Space.s14,
      borderRadius: Radius.input,
      backgroundColor: p.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      boxShadow: shadow(alpha(p.navyInk, 0.05), 2, 8),
    },
    /** ScrollView `style` for the rail body - the `overflow:auto` above 1050. */
    questionNavigatorScroll: { flexGrow: 0, flexShrink: 1 },
    /** ScrollView `contentContainerStyle` for the same. */
    questionNavigatorScrollContent: { gap: Space.s6 },
    questionNavigatorTitle: {
      color: p.navy,
      fontSize: FontSize.f10,
      borderBottomWidth: 2,
      borderBottomColor: p.navy,
      paddingBottom: Space.s10,
      width: '100%', // `.question-navigator > .eyebrow { grid-column: 1 / -1 }`
    },
    /**
     * `.question-navigator > section`. One column of the <=1050 two-up grid;
     * full width above 1050 (a column in the scrolling rail) and at <=760.
     */
    questionNavigatorSection: wide || compact
      ? { gap: Space.s6, marginTop: Space.s14, width: '100%' }
      : { gap: Space.s6, marginTop: Space.s14, ...Grid.columns(2) },
    questionNavigatorSectionTitle: { fontSize: FontSize.f10, color: p.text, marginTop: Space.s8, fontWeight: FontWeight.bold },
    questionNavigatorButton: {
      minHeight: 54,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.s3,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: p.border,
      paddingVertical: Space.s10,
      paddingHorizontal: Space.s4,
      overflow: 'hidden',
      cursor: 'pointer',
    },
    questionNavigatorButtonHover: { borderColor: p.navy },
    questionNavigatorButtonBody: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
    questionNavigatorButtonTitle: {
      fontSize: FontSize.f10,
      fontWeight: FontWeight.heavy,
      color: p.text,
      lineHeight: FontSize.f10 * 1.35,
    },
    questionNavigatorButtonCaption: { fontSize: FontSize.f8, color: p.muted },
    questionNavigatorButtonFlag: { fontSize: FontSize.f8, fontWeight: FontWeight.heavy, color: p.text },
    answerImageWrap: { gap: Space.s10, marginTop: Space.s8, marginHorizontal: Space.s11, marginBottom: Space.s11 },
    answerImage: {
      width: '100%',
      maxHeight: 640,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      backgroundColor: p.surface,
      borderRadius: Radius.chip,
    },
    answerDocumentWrap: { gap: Space.s10, marginTop: Space.s8, marginHorizontal: Space.s11, marginBottom: Space.s11 },
    answerDocument: {
      width: '100%',
      height: compact ? 420 : 300,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      borderRadius: Radius.chip,
      backgroundColor: p.surface,
    },
    reviewEmpty: {
      backgroundColor: p.surface2,
      borderRadius: Radius.md,
      padding: Space.s13,
    },
    reviewEmptyText: { color: p.muted, fontSize: FontSize.f11, lineHeight: FontSize.f11 * LineHeight.body },
    ocrReviewText: {
      backgroundColor: p.surface,
      paddingVertical: Space.s4,
      marginVertical: Space.s10,
      color: p.muted,
      fontSize: FontSize.f11,
      lineHeight: FontSize.f11 * LineHeight.body,
    },
    ocrValidation: {
      gap: Space.s13,
      marginVertical: Space.s16,
      padding: Space.s15,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: mix(p.orange, p.border, 0.45),
      borderRadius: Radius.xxl,
      backgroundColor: mix(p.orange, p.surface, 0.05),
    },
    ocrValidationHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.s12,
    },
    ocrValidationTitle: { marginTop: Space.s3, fontSize: FontSize.f15, color: p.text, fontWeight: FontWeight.bold },
    ocrValidationLead: { color: p.muted, fontSize: FontSize.f9 },
    ocrValidationLabel: { fontSize: FontSize.f9, color: p.navy, fontWeight: FontWeight.bold },
    ocrValidationInput: {
      width: '100%',
      minHeight: 150,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      borderRadius: Radius.md,
      padding: Space.s12,
      backgroundColor: p.surface,
      color: p.text,
      fontSize: FontSize.f10,
      lineHeight: FontSize.f10 * LineHeight.body,
      textAlignVertical: 'top',
    },

    /* ===================== diagnostics and study guide ===================== */
    diagnosticGapList: { gap: Space.s14, marginVertical: Space.s18 },
    diagnosticGapCard: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      borderRadius: Radius.panel,
      overflow: 'hidden',
      backgroundColor: p.surface,
    },
    diagnosticGapCardCritical: { borderColor: mix(p.red, p.border, 0.55) },
    diagnosticGapHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.s11,
      paddingVertical: Space.s13,
      paddingHorizontal: Space.s15,
      backgroundColor: p.surface2,
    },
    diagnosticGapIndex: {
      width: 28,
      height: 28,
      borderRadius: Radius.circle(28),
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: p.navy,
    },
    diagnosticGapIndexText: { color: p.onNavy, fontWeight: FontWeight.heavy },
    diagnosticGapKicker: {
      color: p.orange,
      fontSize: FontSize.f7,
      fontWeight: FontWeight.heavy,
      textTransform: 'uppercase',
      letterSpacing: letterSpacing(FontSize.f7, Tracking.caps),
    },
    diagnosticGapTitle: { marginTop: Space.s3, fontSize: FontSize.f13, color: p.text, fontWeight: FontWeight.bold },
    diagnosticGapMeta: { fontSize: FontSize.f10, color: p.text, fontWeight: FontWeight.bold },
    diagnosticGapBody: { flexDirection: 'row', flexWrap: 'wrap' },
    diagnosticGapCell: {
      flexGrow: 1,
      flexBasis: compact ? '100%' : '45%',
      minWidth: 0,
      paddingVertical: Space.s13,
      paddingHorizontal: Space.s15,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: p.border,
    },
    diagnosticGapCellDivided: compact
      ? {}
      : { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: p.border },
    diagnosticGapTerm: { fontSize: FontSize.f8, fontWeight: FontWeight.heavy, color: p.navy, marginBottom: Space.s5 },
    diagnosticGapDefinition: { color: p.muted, fontSize: FontSize.f9, lineHeight: FontSize.f9 * LineHeight.base },
    diagnosisCallout: {
      paddingVertical: Space.s12,
      paddingHorizontal: Space.s15,
      backgroundColor: mix(p.orange, p.surface, 0.08),
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: p.border,
    },
    diagnosisCalloutTitle: { fontSize: FontSize.f8, color: p.text, fontWeight: FontWeight.bold },
    diagnosisCalloutBody: { fontSize: FontSize.f9, lineHeight: FontSize.f9 * LineHeight.base, marginTop: Space.s5, color: p.text },
    guideOverview: {
      paddingVertical: Space.s12,
      paddingHorizontal: Space.s14,
      borderLeftWidth: 4,
      borderLeftColor: p.orange,
      backgroundColor: p.surface2,
      borderTopRightRadius: Radius.md,
      borderBottomRightRadius: Radius.md,
    },
    guideOverviewText: { fontSize: FontSize.f10, lineHeight: FontSize.f10 * LineHeight.relaxed, color: p.text },
    guideTopicIndex: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.s8, marginVertical: Space.s15 },
    guideTopicIndexItem: {
      ...Grid.autoFit(150),
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.s7,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      borderRadius: Radius.md,
      padding: Space.s9,
    },
    guideTopicIndexBadge: {
      width: 25,
      height: 25,
      borderRadius: Radius.chip,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: p.navy,
    },
    guideTopicIndexBadgeText: { color: p.onNavy, fontSize: FontSize.f8, fontWeight: FontWeight.heavy },
    guideTopicIndexTitle: { fontSize: FontSize.f8, fontWeight: FontWeight.heavy, color: p.text },
    guideTopicIndexCaption: { fontSize: FontSize.f7, color: p.muted },
    guideTopicSections: { gap: Space.s18 },
    guideTopicSection: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      borderRadius: Radius.panel,
      overflow: 'hidden',
    },
    guideTopicSectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.s10,
      paddingVertical: Space.s13,
      paddingHorizontal: Space.s15,
      backgroundColor: mix(p.navy, p.surface2, 0.1),
    },
    guideTopicSectionKicker: {
      fontSize: FontSize.f7,
      color: p.orange,
      fontWeight: FontWeight.heavy,
      textTransform: 'uppercase',
    },
    guideTopicSectionTitle: { fontSize: FontSize.f14, color: p.text, fontWeight: FontWeight.bold },
    guideTopicSectionMeta: { fontSize: FontSize.f11, color: p.text, fontWeight: FontWeight.bold },
    guideLearningGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.s10, padding: Space.s12 },
    guideLearningTrack: compact ? { width: '100%' } : Grid.columns(2),
    guideLearningSpan2: { width: '100%', flexBasis: '100%' },
    guideLearningCard: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      borderRadius: Radius.md,
      padding: Space.s11,
      backgroundColor: p.surface2,
    },
    guideLearningTitle: { fontSize: FontSize.f8, color: p.navy, fontWeight: FontWeight.bold },
    guideLearningBody: { fontSize: FontSize.f9, color: p.muted, lineHeight: FontSize.f9 * LineHeight.body },

    /* ===================== analysis scope and summaries ===================== */
    analysisScope: { marginBottom: Space.s18 },
    analysisScopeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.s12 },
    analysisScopeTrack: compact ? { width: '100%' } : Grid.columns(3),
    analysisScopeLabel: { gap: Space.s7 },
    analysisScopeLabelText: { fontSize: FontSize.f10, fontWeight: FontWeight.heavy, color: p.text },
    analysisScopeNote: { marginTop: Space.s4, fontSize: FontSize.f10, color: p.muted },
    assessmentAnalysisActions: {
      flexDirection: compact ? 'column' : 'row',
      justifyContent: 'space-between',
      alignItems: compact ? 'stretch' : 'flex-end',
      gap: Space.s18,
      marginTop: Space.s20,
      marginBottom: Space.s14,
    },
    assessmentAnalysisTitle: { marginVertical: Space.s4, fontSize: FontSize.f22, color: p.text, fontWeight: FontWeight.bold },
    assessmentAnalysisCaption: { fontSize: FontSize.f10, color: p.muted },
    assessmentSourcePicker: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.s10, marginVertical: Space.s18 },
    assessmentSourceTrack: mini ? { width: '100%' } : Grid.columns(2),
    assessmentSourceOption: {
      alignItems: 'flex-start',
      gap: Space.s5,
      minHeight: 76,
      paddingVertical: Space.s13,
      paddingHorizontal: Space.s15,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      borderRadius: Radius.xl,
      backgroundColor: p.surface,
      cursor: 'pointer',
    },
    assessmentSourceOptionActive: {
      borderColor: p.orange,
      boxShadow: ring(alpha(p.orange, 0.18), 2),
      backgroundColor: mix(p.orange, p.surface, 0.05),
    },
    assessmentSourceTitle: { fontSize: FontSize.f11, color: p.text, fontWeight: FontWeight.bold },
    assessmentSourceCaption: { fontSize: FontSize.f9, color: p.muted, lineHeight: FontSize.f9 * LineHeight.base },
    executiveSummary: {
      backgroundColor: mix(p.navy, p.surface, 0.09),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: mix(p.navy, p.border, 0.24),
      borderLeftWidth: 5,
      borderLeftColor: p.navy,
      borderRadius: Radius.xxl,
      paddingVertical: Space.s17,
      paddingHorizontal: Space.s20,
      marginBottom: Space.s18,
    },
    executiveSummaryTitle: { marginTop: Space.s5, marginBottom: Space.s9, fontSize: FontSize.f16, color: p.text, fontWeight: FontWeight.bold },
    executiveSummaryItem: { fontSize: FontSize.f11, lineHeight: FontSize.f11 * LineHeight.relaxed, color: p.text },
    studentExecutiveSummary: { marginBottom: Space.s18 },
    executiveSummaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.s14, marginTop: Space.s14 },
    executiveSummaryPanel: {
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: compact ? '100%' : '45%',
      minWidth: 0,
      backgroundColor: p.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      borderRadius: Radius.xl,
      overflow: 'hidden',
    },
    executiveSummaryPanelTitle: {
      backgroundColor: p.navy,
      color: p.onNavy,
      paddingVertical: Space.s10,
      paddingHorizontal: Space.s12,
      fontSize: FontSize.f11,
      fontWeight: FontWeight.bold,
    },
    executiveSummaryRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: Space.s16,
      paddingVertical: Space.s8,
      paddingHorizontal: Space.s11,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: p.border,
    },
    executiveSummaryTerm: { color: p.muted, fontSize: FontSize.f10 },
    executiveSummaryValue: { textAlign: 'right', fontWeight: FontWeight.bold, fontSize: FontSize.f10, color: p.text },

    /* ===================== resource library ===================== */
    resourceLibrary: { overflow: 'hidden' },
    resourceTabs: { flexDirection: 'row', gap: Space.s8, marginBottom: Space.s18 },
    resourceTab: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      backgroundColor: p.surface,
      borderRadius: Radius.pill,
      paddingVertical: Space.s9,
      paddingHorizontal: Space.s16,
      cursor: 'pointer',
    },
    resourceTabActive: { backgroundColor: p.navy, borderColor: p.navy },
    resourceTabText: { fontSize: FontSize.f11, fontWeight: FontWeight.heavy, color: p.text },
    resourceTabTextActive: { color: p.onNavy },
    resourceFilters: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.s14, marginBottom: Space.s20 },
    resourceFilterTrack: compact ? { width: '100%' } : Grid.columns(3),
    resourceTable: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      borderRadius: Radius.xl,
      overflow: 'hidden',
    },
    resourceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.s14,
      paddingVertical: Space.s14,
      paddingHorizontal: Space.s16,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: p.border,
      minWidth: compact ? Layout.heatMinWidth : undefined, // horizontal ScrollView on phones
    },
    resourceRowLast: { borderBottomWidth: 0 },
    resourceRowTitleCell: { flexGrow: 1.35, flexShrink: 1, flexBasis: 180, minWidth: 180 },
    resourceRowCell: { flexGrow: 1, flexShrink: 1, flexBasis: 140, minWidth: 140 },
    resourceHead: { backgroundColor: p.surface2 },
    resourceHeadText: {
      color: p.muted,
      fontSize: FontSize.f9,
      textTransform: 'uppercase',
      letterSpacing: letterSpacing(FontSize.f9, 0.07),
      fontWeight: FontWeight.heavy,
    },
    resourceRowTitle: { fontSize: FontSize.f11, color: p.text, fontWeight: FontWeight.bold },
    resourceRowCaption: { color: p.muted, fontSize: FontSize.f9, lineHeight: FontSize.f9 * LineHeight.body },
    resourceActions: { flexDirection: 'row', gap: Space.s12, flexWrap: 'wrap' },

    /* ===================== principal matrix ===================== */
    principalMatrixCard: { marginVertical: Space.s18 },
    matrixLegend: { flexDirection: 'row', gap: Space.s10, flexWrap: 'wrap', marginTop: Space.s12, marginBottom: Space.s18 },
    matrixLegendItem: {
      paddingVertical: Space.s7,
      paddingHorizontal: Space.s11,
      borderRadius: Radius.pill,
    },
    matrixLegendText: { fontSize: FontSize.f12, fontWeight: FontWeight.heavy, color: shade(p.navy, 0.4) },
    principalMatrix: {
      minWidth: Layout.matrixMinWidth, // inside a horizontal ScrollView
      borderWidth: 2,
      borderColor: p.navyEdge,
      borderRadius: Radius.xxl,
      overflow: 'hidden',
      backgroundColor: p.surface,
    },
    matrixHeaderRow: { flexDirection: 'row' },
    matrixRow: { flexDirection: 'row' },
    matrixHeaderCell: {
      flexGrow: 1,
      flexBasis: 0,
      backgroundColor: p.navyDeep,
      padding: Space.s15,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.navyEdge,
      alignItems: 'center',
    },
    matrixHeaderText: { color: p.onNavy, fontWeight: FontWeight.bold },
    matrixSubject: { alignItems: 'flex-start' },
    matrixCell: {
      flexGrow: 1,
      flexBasis: 0,
      minHeight: 88,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.surface,
      padding: Space.s12,
      alignItems: 'center',
      justifyContent: 'center',
      gap: Space.s4,
    },
    matrixCellValue: { fontSize: FontSize.f22, fontWeight: FontWeight.bold },
    matrixCellCaption: { textTransform: 'capitalize', fontSize: FontSize.f10 },
    matrixCellHover: { outlineWidth: 4, outlineColor: mix(p.navy, p.text, 0.8), outlineStyle: 'solid', outlineOffset: -4 },
    /* the four traffic-light tiers - see CAVEATS for the palette mapping */
    tierGreen: { backgroundColor: p.green },
    tierGreenText: { color: p.onNavy },
    tierYellow: { backgroundColor: p.amberLift },
    tierYellowText: { color: shade(p.navy, 0.35) },
    tierOrange: { backgroundColor: p.orange },
    tierOrangeText: { color: shade(p.navy, 0.35) },
    tierRed: { backgroundColor: p.red },
    tierRedText: { color: p.onNavy },
    tierEmpty: { backgroundColor: mix(p.navy, p.surface, 0.06) },
    tierEmptyText: { color: p.inkMuted },
    matrixDrilldown: { marginVertical: Space.s18 },
    performanceDot: { width: 16, height: 16, borderRadius: Radius.circle(16) },

    /* ===================== parent dashboard and share ===================== */
    parentShareButton: { marginTop: Space.s8 },
    parentSharePanel: { alignItems: 'center', gap: Space.s12 },
    parentShareQr: {
      width: 260,
      maxWidth: '100%',
      backgroundColor: p.surface,
      borderWidth: 12,
      borderColor: p.surface,
      borderRadius: Radius.xl,
      boxShadow: shadow(alpha(p.navyInk, 0.13), 8, 30),
    },
    parentShareInput: { width: '100%' },
    parentDashboard: {
      flex: 1,
      backgroundColor: mix(p.navy, WHITE, 0.05), // #f3f6fb - fixed, printable palette
      padding: parentCompact ? Space.s14 : Space.s28, // @media(max-width:700px)
    },
    parentDashboardInner: { width: '100%', maxWidth: Layout.parentMaxWidth, marginHorizontal: 'auto' },
    parentHero: {
      backgroundColor: p.navyDeep,
      borderRadius: Radius.hero,
      padding: Space.s30,
      marginBottom: Space.s18,
    },
    parentHeroLogo: { width: 180, backgroundColor: WHITE, borderRadius: Radius.chip, padding: Space.s8 },
    parentHeroEyebrow: {
      color: p.amberBright,
      textTransform: 'uppercase',
      fontWeight: FontWeight.heavy,
      letterSpacing: letterSpacing(FontSize.f10, Tracking.caps),
      fontSize: FontSize.f10,
    },
    parentHeroTitle: { color: WHITE, fontSize: FontSize.f38, marginVertical: Space.s8, fontWeight: FontWeight.bold },
    parentSummary: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.s12, marginBottom: Space.s18 },
    parentSummaryTrack: Grid.columns(parentCompact ? 2 : 4),
    parentSummaryCard: {
      backgroundColor: WHITE,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: mix(p.navy, WHITE, 0.11),
      borderRadius: Radius.card,
      padding: Space.s20,
    },
    parentSummaryLabel: { color: p.inkMuted, fontSize: FontSize.f11 },
    parentSummaryValue: { fontSize: FontSize.f19, marginTop: Space.s6, color: p.navyInk, fontWeight: FontWeight.bold },
    parentCard: {
      backgroundColor: WHITE,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: mix(p.navy, WHITE, 0.11),
      borderRadius: Radius.card,
      padding: Space.s20,
      marginBottom: Space.s18,
    },
    parentCardText: { color: p.navyInk },
    parentCardButton: {
      alignSelf: 'flex-start',
      backgroundColor: p.navy,
      borderRadius: Radius.input,
      paddingVertical: Space.s11,
      paddingHorizontal: Space.s16,
    },
    parentCardButtonText: { color: WHITE, fontWeight: FontWeight.bold },
    parentLabel: {
      color: shade(p.orange, 0.05),
      fontWeight: FontWeight.heavy,
      textTransform: 'uppercase',
      fontSize: FontSize.f11,
    },
    parentGap: {
      borderLeftWidth: 5,
      borderLeftColor: p.amberBright,
      backgroundColor: mix(p.navy, WHITE, 0.03),
      padding: Space.s14,
      marginVertical: Space.s12,
      borderRadius: Radius.chip,
    },
    parentGapHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: Space.s12 },
    parentScore: {
      flexDirection: 'row',
      gap: Space.s6,
      alignItems: 'center',
      backgroundColor: WHITE,
      padding: Space.s11,
      borderRadius: Radius.lg,
    },
    parentScoreValue: { fontSize: FontSize.f23, color: p.navy, fontWeight: FontWeight.bold },
    parentScoreLabel: { fontSize: FontSize.f7, color: p.navyInk },

    /* ===================== evaluator workspace ===================== */
    evaluatorWorkspace: {
      marginVertical: Space.s22,
      padding: Space.s20,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: mix(p.navy, p.surface, 0.28),
      borderRadius: Radius.card,
      backgroundColor: p.navyWash,
    },
    evaluatorWorkspaceHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: Space.s16,
    },
    evaluatorQuestionList: { gap: Space.s12, marginTop: Space.s16 },
    evaluatorQuestionCard: {
      padding: Space.s16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: mix(p.navy, p.surface, 0.15),
      borderLeftWidth: 5,
      borderLeftColor: shade(p.orange, 0.2),
      borderRadius: Radius.xxl,
      backgroundColor: p.surface,
    },
    evaluatorQuestionCardReviewed: { borderLeftColor: shade(p.green, 0.08) },
    evaluatorQuestionHead: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: Space.s16,
    },
    evaluatorQuestionCaption: { marginTop: Space.s4, color: p.inkMuted, fontSize: FontSize.f11 },
    evaluationTotal: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: Space.s16,
      marginTop: Space.s16,
      paddingVertical: Space.s14,
      paddingHorizontal: Space.s16,
      borderRadius: Radius.xl,
      backgroundColor: mix(p.navy, p.surface, 0.08),
    },
    evaluationTotalValue: { fontSize: FontSize.f20, color: p.text, fontWeight: FontWeight.bold },

    /* ===================== marketing home =====================
     * The `--m-*` sub-palette maps onto the app palette - see CAVEATS. */
    mkt: { flex: 1, backgroundColor: p.bg },
    mktNav: {
      height: mktCompact ? 66 : 76,
      paddingHorizontal: mktCompact ? Space.s22 : Space.s76,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: alpha(p.navy, 0.12),
      backgroundColor: p.bg,
      zIndex: 30,
    },
    mktBrand: { flexDirection: 'row', alignItems: 'center', gap: Space.s12 },
    mktBrandLogo: { width: mktCompact ? 95 : 112, height: 42 },
    mktBrandDivider: {
      display: mktCompact ? 'none' : 'flex',
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: p.lineWarm,
      paddingLeft: Space.s12,
    },
    mktBrandName: { fontSize: FontSize.f12, color: p.navyInk, fontWeight: FontWeight.bold },
    mktBrandCaption: { fontSize: FontSize.f8, color: p.inkMuted, marginTop: Space.s3 },
    mktNavLinks: { flexDirection: 'row', alignItems: 'center', gap: Space.s24 },
    mktNavLink: {
      display: mktCompact ? 'none' : 'flex',
      fontSize: FontSize.f11,
      fontWeight: FontWeight.bold,
      color: p.navy,
    },
    navSignin: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.navy,
      borderRadius: Radius.pill,
      paddingVertical: Space.s10,
      paddingHorizontal: Space.s17,
    },
    mktEyebrow: {
      fontSize: FontSize.f10,
      letterSpacing: letterSpacing(FontSize.f10, Tracking.eyebrowWide),
      textTransform: 'uppercase',
      color: p.amberDeep,
      fontWeight: FontWeight.heavy,
      marginBottom: Space.s13,
    },
    mktEyebrowOnNavy: { color: p.amberPale },
    mktHero: {
      flexDirection: mktWide ? 'row' : 'column',
      alignItems: 'center',
      gap: mktCompact ? Space.s44 : Space.s90,
      paddingVertical: mktCompact ? Space.s55 : Space.s100,
      paddingHorizontal: mktCompact ? Space.s22 : Space.s76,
      backgroundColor: p.bg,
    },
    heroCopy: { flexGrow: 0.93, flexShrink: 1, flexBasis: 0, minWidth: 0 },
    heroTitle: {
      fontSize: mktCompact ? FontSize.f48 : FontSize.f88,
      lineHeight: (mktCompact ? FontSize.f48 : FontSize.f88) * 0.96,
      letterSpacing: letterSpacing(mktCompact ? FontSize.f48 : FontSize.f88, Tracking.marketing),
      marginBottom: Space.s28,
      maxWidth: 900,
      color: p.navy,
      fontWeight: FontWeight.bold,
    },
    heroLead: {
      fontSize: mktCompact ? FontSize.f16 : FontSize.f20,
      lineHeight: (mktCompact ? FontSize.f16 : FontSize.f20) * LineHeight.relaxed,
      maxWidth: 760,
      color: p.inkSoft,
    },
    trustStrip: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      rowGap: Space.s10,
      columnGap: Space.s22,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: p.lineWarm,
      paddingVertical: Space.s17,
      marginTop: Space.s30,
      marginBottom: Space.s26,
    },
    trustStripItem: { fontSize: FontSize.f10, fontWeight: FontWeight.heavy, color: p.navy },
    heroActions: { flexDirection: 'row', alignItems: 'center', gap: Space.s22, flexWrap: 'wrap' },
    mktPrimary: {
      minHeight: 52,
      paddingHorizontal: Space.s22,
      borderRadius: Radius.xl,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: p.navy,
      boxShadow: shadow(alpha(p.navy, 0.2), 12, 28),
    },
    mktPrimaryHover: { transform: [{ translateY: -2 }] },
    mktPrimaryText: { color: p.onNavy, fontSize: FontSize.f12, fontWeight: FontWeight.heavy },
    mktPrimaryLight: { backgroundColor: WHITE },
    mktPrimaryLightText: { color: p.navy },
    mktSecondary: {
      minHeight: 52,
      paddingHorizontal: Space.s22,
      borderRadius: Radius.xl,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.navy,
    },
    mktSecondaryText: { color: p.navy, fontSize: FontSize.f12, fontWeight: FontWeight.heavy },
    mktLink: { color: p.navy, fontWeight: FontWeight.heavy, fontSize: FontSize.f12 },
    micro: { fontSize: FontSize.f10, lineHeight: FontSize.f10 * LineHeight.relaxed, color: p.inkMuted, maxWidth: 690, marginTop: Space.s15 },
    xrayReveal: {
      flexGrow: 1.07,
      flexShrink: 1,
      flexBasis: mktWide ? 480 : 0,
      minHeight: mktCompact ? 460 : mktWide ? 590 : 530,
      backgroundColor: mix(p.orange, p.border, 0.25),
      borderWidth: mktCompact ? 7 : 13,
      borderColor: WHITE,
      borderRadius: Radius.hero,
      boxShadow: shadow(alpha(p.navyInk, 0.18), 30, 80),
      overflow: 'hidden',
    },
    answerScript: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      padding: mktCompact ? Space.s28 : Space.s58,
      backgroundColor: WHITE, // repeating-linear-gradient rule lines - see CAVEATS
      transform: [{ rotate: '-0.6deg' }],
    },
    answerScriptText: { fontSize: FontSize.f15, lineHeight: FontSize.f15 * LineHeight.body, color: mix(p.text, p.navy, 0.65) },
    paperTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      borderBottomWidth: 2,
      borderBottomColor: tint(p.text, 0.09),
      paddingBottom: Space.s15,
      marginBottom: Space.s28,
    },
    paperStamp: {
      color: p.dangerBright,
      fontSize: mktCompact ? FontSize.f19 : FontSize.f28,
      fontWeight: FontWeight.black,
      borderWidth: 3,
      borderColor: p.dangerBright,
      borderRadius: Radius.pill,
      paddingVertical: Space.s5,
      paddingHorizontal: Space.s12,
      transform: [{ rotate: '7deg' }],
    },
    handwriting: { color: mix(p.navy, WHITE, 0.85), fontSize: FontSize.f17 }, // cursive face - see CAVEATS
    scanSide: {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      backgroundColor: alpha(p.navy, 0.7),
    },
    scanLine: { position: 'absolute', top: 0, bottom: 0, width: 3, backgroundColor: p.orange },
    tag: {
      position: 'absolute',
      borderRadius: Radius.pill,
      paddingVertical: mktCompact ? Space.s6 : Space.s8,
      paddingHorizontal: mktCompact ? Space.s6 : Space.s11,
      boxShadow: shadow(alpha(p.navyInk, 0.25), 7, 18),
    },
    tagText: { fontSize: mktCompact ? FontSize.f7 : FontSize.f9, fontWeight: FontWeight.heavy },
    gapTag: { backgroundColor: p.amberSoft },
    gapTagText: { color: p.amberText },
    secureTag: { backgroundColor: tint(p.green, 0.85) },
    secureTagText: { color: shade(p.green, 0.27) },
    sliderHandle: {
      position: 'absolute',
      top: '50%',
      width: 44,
      height: 44,
      marginTop: -22,
      marginLeft: -22,
      borderRadius: Radius.circle(44),
      backgroundColor: WHITE,
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: shadow(alpha(p.navyInk, 0.25), 8, 25),
      zIndex: 6,
    },
    sliderHandleText: { color: p.navy, fontWeight: FontWeight.black },
    explainer: {
      paddingVertical: mktCompact ? Space.s72 : Space.s90,
      paddingHorizontal: mktCompact ? Space.s20 : Space.s120,
      backgroundColor: p.navy,
      flexDirection: mktWide ? 'row' : 'column',
      gap: mktWide ? Space.s80 : Space.s25,
      alignItems: mktWide ? 'flex-end' : 'stretch',
    },
    explainerTitle: {
      maxWidth: 730,
      color: p.onNavy,
      fontSize: mktCompact ? FontSize.f34 : FontSize.f56,
      lineHeight: (mktCompact ? FontSize.f34 : FontSize.f56) * 1.04,
      letterSpacing: letterSpacing(mktCompact ? FontSize.f34 : FontSize.f56, Tracking.marketing),
      fontWeight: FontWeight.bold,
    },
    explainerBody: {
      fontSize: FontSize.f16,
      lineHeight: FontSize.f16 * LineHeight.loose,
      color: p.onNavyLead,
      marginBottom: Space.s18,
    },
    mktSection: {
      paddingVertical: mktCompact ? Space.s76 : Space.s110,
      paddingHorizontal: mktCompact ? Space.s20 : Space.s110,
    },
    mktSectionHeader: { maxWidth: 900, marginBottom: Space.s48 },
    mktSectionTitle: {
      fontSize: mktCompact ? FontSize.f34 : FontSize.f56,
      lineHeight: (mktCompact ? FontSize.f34 : FontSize.f56) * 1.04,
      letterSpacing: letterSpacing(mktCompact ? FontSize.f34 : FontSize.f56, Tracking.marketing),
      color: p.navyInk,
      fontWeight: FontWeight.bold,
    },
    personas: { backgroundColor: p.surface },
    personaTabs: { flexDirection: mktCompact ? 'column' : 'row', gap: Space.s10, marginBottom: Space.s18 },
    personaTab: {
      flexGrow: 1,
      flexBasis: 0,
      minHeight: 60,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.navy,
      backgroundColor: p.bg,
      borderRadius: Radius.pill,
      cursor: 'pointer',
    },
    personaTabSelected: { backgroundColor: p.navy },
    personaTabText: { color: p.navy, fontSize: FontSize.f11, fontWeight: FontWeight.heavy },
    personaTabTextSelected: { color: p.bg },
    personaPanel: {
      backgroundColor: p.bg,
      borderRadius: Radius.hero,
      padding: mktCompact ? Space.s30 : Space.s64,
      flexDirection: mktCompact ? 'column' : 'row',
      gap: mktCompact ? Space.s20 : Space.s70,
    },
    personaPanelIntro: { flexGrow: 0.7, flexShrink: 1, flexBasis: 0, minWidth: 0 },
    personaPanelBody: { flexGrow: 1.3, flexShrink: 1, flexBasis: 0, minWidth: 0 },
    personaPanelKicker: {
      color: p.amberDeep,
      textTransform: 'uppercase',
      letterSpacing: letterSpacing(FontSize.f10, Tracking.caps),
      fontSize: FontSize.f10,
      fontWeight: FontWeight.heavy,
    },
    personaPanelTitle: {
      fontSize: mktCompact ? FontSize.f34 : FontSize.f56,
      color: p.navy,
      marginVertical: Space.s12,
      letterSpacing: letterSpacing(mktCompact ? FontSize.f34 : FontSize.f56, Tracking.marketing),
      fontWeight: FontWeight.bold,
    },
    personaPanelItem: {
      flexDirection: 'row',
      gap: Space.s12,
      paddingVertical: Space.s15,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: p.lineWarm,
    },
    personaPanelBullet: { color: p.amberDeep, fontWeight: FontWeight.black },
    personaPanelItemText: { fontSize: FontSize.f14, lineHeight: FontSize.f14 * LineHeight.body, color: p.navyInk },
    heatSection: { backgroundColor: mix(p.navy, WHITE, 0.07) },
    heatLayout: { flexDirection: mktWide ? 'row' : 'column', gap: Space.s32 },
    heatCard: {
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 0,
      minWidth: 0,
      backgroundColor: WHITE,
      padding: Space.s26,
      borderRadius: Radius.hero - 2,
      boxShadow: shadow(alpha(p.navy, 0.09), 20, 50),
    },
    heatKey: { flexDirection: 'row', gap: Space.s9, justifyContent: 'flex-end', marginBottom: Space.s18 },
    heatKeyItem: { paddingVertical: Space.s6, paddingHorizontal: Space.s9, borderRadius: Radius.pill },
    heatKeyText: { fontSize: FontSize.f8, fontWeight: FontWeight.heavy },
    mktHeat: { minWidth: Layout.heatMinWidth, gap: Space.s6 },
    mktHeatRow: { flexDirection: 'row', gap: Space.s6, alignItems: 'center' },
    mktHeatColLabel: { flexGrow: 1, flexBasis: 0, fontSize: FontSize.f9, textAlign: 'center', color: p.inkMuted },
    mktHeatRowLabel: { fontSize: FontSize.f9, color: p.inkSoft, width: 120 },
    mktHeatCell: { flexGrow: 1, flexBasis: 0, height: 28, borderRadius: Radius.sm },
    tierSecure: { backgroundColor: p.navy },
    tierSecureText: { color: p.onNavy },
    tierPartial: { backgroundColor: p.navyMid },
    tierPartialText: { color: shade(p.navy, 0.16) },
    tierGapMkt: { backgroundColor: p.orange },
    tierGapMktText: { color: p.amberText },
    heatAside: {
      width: mktWide ? 280 : '100%',
      gap: Space.s12,
      justifyContent: 'center',
      flexDirection: mktWide ? 'column' : 'row',
      flexWrap: 'wrap',
    },
    /** One `.heat-layout aside` card: full width above 1000, then 3-up, then 1-up. */
    heatAsideTrack: mktWide || mktCompact ? { width: '100%' } : Grid.columns(3),
    heatAsideCard: {
      backgroundColor: WHITE,
      borderLeftWidth: 4,
      borderLeftColor: p.orange,
      borderRadius: Radius.md,
      padding: Space.s15,
    },
    heatAsideTitle: { color: p.amberDeep, fontSize: FontSize.f9, marginBottom: Space.s5, fontWeight: FontWeight.bold },
    heatAsideText: { fontSize: FontSize.f11, lineHeight: FontSize.f11 * LineHeight.body, color: p.navyInk },
    stageCycle: {
      flexDirection: 'row',
      gap: Space.s12,
      flexWrap: 'nowrap', // repeat(5,230px) inside a horizontal ScrollView at <=1000
      paddingBottom: mktWide ? 0 : Space.s25,
    },
    stageCycleConnector: {
      position: 'absolute',
      left: '8%',
      right: '8%',
      top: 31,
      height: 2,
      backgroundColor: mix(p.navy, WHITE, 0.3),
    },
    stageCard: {
      flexGrow: 1,
      flexBasis: mktWide ? 0 : 230,
      minWidth: mktWide ? 0 : 230,
      zIndex: 1,
      backgroundColor: WHITE,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: mix(p.navy, WHITE, 0.18),
      borderRadius: Radius.card,
      padding: Space.s18,
      minHeight: 260,
    },
    stageCardActive: {
      backgroundColor: p.navy,
      transform: [{ scale: 1.04 }],
      boxShadow: shadow(alpha(p.navy, 0.2), 18, 38),
    },
    stageCardIndex: {
      width: 30,
      height: 30,
      borderRadius: Radius.circle(30),
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: p.bg,
      borderWidth: 2,
      borderColor: p.navy,
    },
    stageCardIndexActive: { backgroundColor: p.orange, borderColor: p.orange },
    stageCardIndexText: { color: p.navy, fontSize: FontSize.f10, fontWeight: FontWeight.black },
    stageCardTitle: { fontSize: FontSize.f28, color: p.navy, marginTop: Space.s22, marginBottom: Space.s12, fontWeight: FontWeight.bold },
    stageCardTitleActive: { color: p.onNavy },
    stageCardBody: { fontSize: FontSize.f10, lineHeight: FontSize.f10 * LineHeight.relaxed, color: p.inkMuted },
    stageCardBodyActive: { color: p.onNavy },
    stageCardTag: {
      alignSelf: 'flex-start',
      marginTop: Space.s10,
      backgroundColor: p.warningSoftBg,
      borderRadius: Radius.pill,
      paddingVertical: Space.s6,
      paddingHorizontal: Space.s8,
    },
    stageCardTagText: { color: p.warningSoftText, fontSize: FontSize.f8 },
    closingLine: { textAlign: 'center', fontSize: FontSize.f14, fontWeight: FontWeight.heavy, color: p.navy, marginTop: Space.s38 },
    authority: { backgroundColor: p.surface },
    authorityTable: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.lineWarm,
      borderRadius: Radius.modal,
      overflow: 'hidden',
    },
    authorityRow: { flexDirection: 'row' },
    authorityCell: {
      flexGrow: 1,
      flexBasis: 0,
      paddingVertical: mktCompact ? Space.s13 : Space.s17,
      paddingHorizontal: mktCompact ? Space.s13 : Space.s22,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: p.lineWarm,
    },
    authorityCellLead: { backgroundColor: mix(p.border, p.bg, 0.6) },
    authorityCellLeadText: { color: p.inkMuted, fontSize: mktCompact ? FontSize.f10 : FontSize.f12 },
    authorityCellValue: { backgroundColor: p.bg },
    authorityCellValueText: { color: p.navy, fontSize: mktCompact ? FontSize.f10 : FontSize.f12, fontWeight: FontWeight.bold },
    authorityHead: { backgroundColor: p.navy },
    authorityHeadLead: { backgroundColor: tint(p.muted, 0.1) },
    authorityHeadText: {
      color: p.onNavy,
      textTransform: 'uppercase',
      letterSpacing: letterSpacing(FontSize.f9, 0.1),
      fontSize: FontSize.f9,
      fontWeight: FontWeight.bold,
    },
    founding: {
      flexDirection: mktWide ? 'row' : 'column',
      gap: Space.s80,
      alignItems: 'center',
      backgroundColor: mix(p.orange, p.bg, 0.08),
    },
    foundingCopy: { flexGrow: 1.2, flexShrink: 1, flexBasis: 0, minWidth: 0 },
    foundingBody: {
      fontSize: FontSize.f16,
      lineHeight: FontSize.f16 * LineHeight.loose,
      maxWidth: 720,
      color: p.inkSoft,
      marginBottom: Space.s28,
    },
    phone: {
      width: 290,
      marginHorizontal: 'auto',
      backgroundColor: shade(p.navy, 0.6),
      borderWidth: 9,
      borderColor: shade(p.navy, 0.6),
      borderRadius: Radius.phone,
      boxShadow: shadow(alpha(p.navyInk, 0.22), 30, 65),
      overflow: 'hidden',
    },
    phoneBar: {
      height: 52,
      backgroundColor: WHITE,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: Space.s16,
    },
    phoneBarText: { color: p.inkMuted, fontSize: FontSize.f9 },
    phoneBarDot: { width: 8, height: 8, borderRadius: Radius.circle(8), backgroundColor: tint(p.green, 0.2) },
    phoneBody: { backgroundColor: p.bg, padding: Space.s24 },
    phoneKicker: { color: p.amberDeep, textTransform: 'uppercase', fontSize: FontSize.f8, fontWeight: FontWeight.heavy },
    phoneTitle: { fontSize: FontSize.f25, color: p.navy, marginTop: Space.s7, marginBottom: Space.s18, fontWeight: FontWeight.bold },
    phoneRow: {
      flexDirection: 'row',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: p.lineWarm,
      paddingVertical: Space.s10,
    },
    phoneRowText: { fontSize: FontSize.f8, color: p.navyInk },
    phoneFootnote: {
      fontSize: FontSize.f7,
      color: p.inkMuted,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: p.lineWarm,
      paddingTop: Space.s11,
    },
    featureGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.s12 },
    featureTrack: mktCompact ? { width: '100%' } : Grid.columns(mktWide ? 3 : 2),
    featureCard: {
      minHeight: 150,
      backgroundColor: WHITE,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.lineWarm,
      borderRadius: Radius.card - 2,
      padding: Space.s20,
    },
    featureCardKicker: { color: p.amberDeep, fontSize: FontSize.f9, fontWeight: FontWeight.heavy },
    featureCardBody: { fontSize: FontSize.f13, lineHeight: FontSize.f13 * LineHeight.body, color: p.navy, fontWeight: FontWeight.bold },
    safety: {
      flexDirection: mktWide ? 'row' : 'column',
      gap: Space.s70,
      alignItems: 'center',
      backgroundColor: p.navy,
    },
    safetyCopy: { flexGrow: 1.2, flexShrink: 1, flexBasis: 0, minWidth: 0 },
    safetyBody: { color: p.onNavyLead, fontSize: FontSize.f14, lineHeight: FontSize.f14 * LineHeight.loose },
    safetySeal: {
      flexGrow: 0.8,
      flexShrink: 1,
      flexBasis: 0,
      minWidth: 0,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.lineOnDark,
      borderRadius: Radius.hero,
      padding: Space.s34,
      alignItems: 'center',
    },
    safetySealIcon: {
      width: 64,
      height: 64,
      borderRadius: Radius.circle(64),
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: p.orange,
    },
    safetySealIconText: { color: p.navy, fontSize: FontSize.f30 },
    safetySealTitle: { color: p.onNavy, fontSize: FontSize.f22, marginTop: Space.s16, marginBottom: Space.s7, fontWeight: FontWeight.bold },
    safetySealCaption: { color: p.onNavyLead, textAlign: 'center', fontSize: FontSize.f11 },
    rolloutTimeline: {
      // repeat(5,220px) inside a horizontal ScrollView at <=1000.
      flexDirection: 'row',
      gap: Space.s7,
      borderTopWidth: 5,
      borderTopColor: mix(p.navy, WHITE, 0.16),
      paddingTop: Space.s20,
    },
    rolloutCard: {
      flexGrow: 1,
      flexBasis: mktWide ? 0 : 220,
      minWidth: mktWide ? 0 : 220,
      minHeight: 170,
      backgroundColor: WHITE,
      borderRadius: Radius.xxl,
      padding: Space.s17,
    },
    rolloutCardTitle: { color: p.navy, fontWeight: FontWeight.bold },
    rolloutCardBody: { fontSize: FontSize.f10, lineHeight: FontSize.f10 * LineHeight.body, color: p.inkMuted },
    rolloutCardTag: {
      alignSelf: 'flex-start',
      backgroundColor: mix(p.navy, WHITE, 0.06),
      borderRadius: Radius.pill,
      paddingVertical: Space.s6,
      paddingHorizontal: Space.s8,
    },
    rolloutCardTagText: { color: p.inkMuted, fontSize: FontSize.f8 },
    pricing: {
      backgroundColor: p.orange,
      flexDirection: mktWide ? 'row' : 'column',
      alignItems: mktWide ? 'center' : 'stretch',
      justifyContent: 'space-between',
      gap: Space.s48,
    },
    pricingCopy: { maxWidth: 850 },
    faq: { backgroundColor: p.surface },
    faqItem: {
      maxWidth: 960,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: p.lineWarm,
    },
    faqSummary: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: Space.s22,
      cursor: 'pointer',
    },
    faqSummaryText: { fontWeight: FontWeight.heavy, color: p.navy },
    faqSummaryIcon: { fontSize: FontSize.f20, color: p.navy },
    faqBody: { marginBottom: Space.s22, lineHeight: FontSize.f13 * LineHeight.loose, color: p.inkSoft, fontSize: FontSize.f13 },
    finalCta: {
      paddingVertical: mktCompact ? Space.s80 : Space.s120,
      paddingHorizontal: mktCompact ? Space.s20 : Space.s120,
      alignItems: 'center',
      backgroundColor: p.bg,
    },
    finalCtaTitle: {
      fontSize: mktCompact ? FontSize.f42 : FontSize.f72,
      lineHeight: (mktCompact ? FontSize.f42 : FontSize.f72) * 1.04,
      letterSpacing: letterSpacing(mktCompact ? FontSize.f42 : FontSize.f72, Tracking.marketing),
      maxWidth: 1100,
      textAlign: 'center',
      marginBottom: Space.s38,
      color: p.navy,
      fontWeight: FontWeight.bold,
    },
    finalCtaActions: { flexDirection: 'row', justifyContent: 'center', gap: Space.s12, flexWrap: 'wrap' },
    finalSignin: {
      textAlign: mktCompact ? 'center' : 'right',
      color: p.navy,
      fontSize: FontSize.f10,
      fontWeight: FontWeight.heavy,
      marginTop: mktCompact ? Space.s44 : Space.s70,
    },
    mktFooter: {
      minHeight: 110,
      paddingVertical: Space.s26,
      paddingHorizontal: mktCompact ? Space.s22 : Space.s76,
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: Space.s26,
      backgroundColor: shade(p.navy, 0.3),
    },
    mktFooterLogo: { width: 110 }, // tintColor: white (filter: brightness(0) invert(1))
    mktFooterText: { fontSize: FontSize.f10, color: p.onNavyFaint },
    mktFooterNav: { marginLeft: mktCompact ? 0 : 'auto', flexDirection: 'row', gap: Space.s18 },
    mktFooterLink: { color: p.onNavy, fontSize: FontSize.f10 },

    /* ===================== remaining classes and aliases ===================== */
    /** `.functional-shell` - the demo shell: focus rings and disabled state. */
    functionalShell: { flex: 1 },
    focusRing: { outlineWidth: 3, outlineStyle: 'solid', outlineColor: alpha(p.orange, 0.55), outlineOffset: 2 },
    disabled: { opacity: 0.5, cursor: 'auto' },
    /** `.branded-report` - a .card carrying the branded-document treatment. */
    brandedReport: {
      overflow: 'hidden',
      borderColor: mix(p.navy, p.border, 0.25),
      boxShadow: shadow(alpha(p.navyInk, 0.09), 16, 44),
    },
    brandedReportHeader: { marginTop: -Space.s18, marginHorizontal: -Space.s18, marginBottom: Space.s15 },
    evidenceUploadList: { gap: Space.s8 },
    evidenceUploadListSelect: { marginTop: Space.s7, maxWidth: 270 },
    /* `.weak` / `.average` / `.excellent` are the heat tiers under a second name. */
    tierWeak: { backgroundColor: p.dangerSoftBg },
    tierWeakText: { color: p.dangerSoftText },
    tierAverage: { backgroundColor: p.warningSoftBg },
    tierAverageText: { color: p.warningSoftText },
    tierExcellent: { backgroundColor: p.successSoftBg },
    tierExcellentText: { color: p.successSoftText },
  });
}

/* ------------------------------------------------------------------------- *
 * 6. Accessors
 * ------------------------------------------------------------------------- */

export type AppStyles = ReturnType<typeof createStyles>;

const cache = new Map<string, AppStyles>();

/**
 * The widest window in each band, so two windows that resolve every media query
 * the same way share one sheet. `Breakpoints` in ascending order, plus one
 * representative above the last of them.
 */
const BANDS = [
  Breakpoints.mini,
  Breakpoints.mktCompact,
  Breakpoints.parent,
  Breakpoints.compact,
  Breakpoints.demoAuth,
  Breakpoints.mktMedium,
  Breakpoints.medium,
  1440,
] as const;

/** Quantise a window so the cache holds one sheet per band, not per pixel. */
function bandOf(width: number): number {
  return BANDS.find((edge) => width <= edge) ?? 1440;
}

/** The window height only feeds `max-height: calc(100vh - ...)`; 80px is plenty. */
function heightBucket(height: number): number {
  return Math.min(2000, Math.max(480, Math.round(height / 80) * 80));
}

/**
 * Memoised. The key is (scheme, shell breakpoint, width band, height bucket) -
 * two schemes x three sizes x eight bands, times however many window heights
 * the session actually sees.
 */
export function getStyles(
  scheme: Scheme = 'light',
  size: LayoutSize = 'wide',
  viewport: Viewport = viewportFor(size),
): AppStyles {
  const w = bandOf(viewport.width);
  const h = heightBucket(viewport.height);
  const key = scheme + ':' + size + ':' + w + ':' + h;
  const hit = cache.get(key);
  if (hit) return hit;

  const built = createStyles(scheme, size, { width: w, height: h });
  cache.set(key, built);
  return built;
}

/** The default (light, desktop) sheet, for modules outside a React tree. */
export const styles = getStyles('light', 'wide');

/** Scheme- and width-aware styles. This is what components should use. */
export function useAppStyles(): AppStyles {
  const scheme = useColorScheme();
  const { width, height } = useWindowDimensions();
  const resolved: Scheme = scheme === 'dark' ? 'dark' : 'light';
  const size = layoutFor(width);
  const band = bandOf(width);
  const bucket = heightBucket(height);

  return useMemo(
    () => getStyles(resolved, size, { width: band, height: bucket }),
    [resolved, size, band, bucket],
  );
}

/** The derived palette for the current scheme, for one-off inline colours. */
export function useAppPalette(): Palette {
  const scheme = useColorScheme();
  const resolved: Scheme = scheme === 'dark' ? 'dark' : 'light';

  return useMemo(() => palette(resolved), [resolved]);
}

/* ------------------------------------------------------------------------- *
 * 7. CAVEATS - what the CSS could not carry across
 *
 * BREAKPOINTS
 *  - `grep -o '@media[^{]*'` over globals.css, marketing.css and
 *    persistence.css returns nine queries on seven distinct widths. All seven
 *    are honoured; each has exactly one flag inside `createStyles`:
 *
 *      560   globals.css   .assessment-source-picker -> 1fr; the demo-auth
 *                          story/card type ramp, its steps and role badge -> `mini`
 *      680   marketing.css the marketing page's phone layout (nav, hero type,
 *                          persona panel, feature grid, heat aside) -> `mktCompact`
 *      700   globals.css   .parent-summary 4 columns -> 2, .parent-dashboard
 *                          padding                                  -> `parentCompact`
 *      760   globals.css   the app's phone layout: sidebar out, mobile nav in,
 *            + persistence and every `1fr` collapse                  -> `compact` (LayoutSize)
 *      900   globals.css   .demo-auth splits into two rows           -> `demoCompact`
 *      1000  marketing.css the marketing tablet layout: hero/explainer/
 *                          founding/safety stack, feature grid 3->2, the stage
 *                          cycle and rollout timeline start scrolling -> `mktWide` (inverted)
 *      1050  globals.css   the app's tablet layout: review rail down,
 *                          every grid drops a column or two          -> `medium`/`wide` (LayoutSize)
 *
 *    `LayoutSize` still has three values on purpose: it is the *shell's*
 *    breakpoint (760 and 1050), the one components branch on to decide whether
 *    to render a sidebar or a mobile nav. The other four are not shell states,
 *    so they are resolved from the raw window width instead - which is why
 *    `createStyles`/`getStyles` take a `Viewport` and `useAppStyles` passes
 *    `useWindowDimensions()` through. `getStyles` quantises that window to one
 *    sheet per band, so the cache stays at a handful of entries.
 *  - What is still approximate, and what it costs: the CSS `clamp()` ramps
 *    (.mkt-hero and .explainer padding, .persona-panel padding, the demo-auth
 *    story padding and h1) are continuous functions of the viewport, not steps.
 *    Each is pinned to the clamp's min at the small end and its max at the
 *    large end, so between the two the RN value can differ from the web by up
 *    to the width of the ramp - a few px of padding, and up to ~10px of type on
 *    the two marketing headlines. `@media print` and
 *    `@media(prefers-reduced-motion)` are not widths; see PAINT.
 *
 * LAYOUT
 *  - `display: grid` / `grid-template-columns`: no RN equivalent. Every grid is
 *    a flex row that wraps; the track widths live in the matching `*Track`
 *    style (`Grid.columns`, `Grid.track`, `Grid.minTrack`, `Grid.autoFit`,
 *    `Grid.fixed` build ad-hoc ones).
 *    `grid-column: span 2` and `1 / -1` become `width: '100%'`.
 *  - `repeat(n, 1fr)` needs `Grid.columns(n)`, not `Grid.track()`: a zero flex
 *    basis puts every child on one line, so a grid holding more children than
 *    it has columns would never wrap. `Grid.columns` gives the track a
 *    percentage basis instead - see its doc comment for the arithmetic and for
 *    the container width each column count needs. Two consequences: a partly
 *    filled final row stretches across the container where CSS grid would leave
 *    the missing columns empty (`Grid.filler` holds them open), and a row whose
 *    columns genuinely never wrap - `.tr`, `.review-student-details` above 1050
 *    - stays on `Grid.track` so its `fr` weights stay exact.
 *  - `position: sticky` (.topbar, .mkt-nav, .question-navigator): RN has no
 *    sticky. Use a fixed header outside the ScrollView, or
 *    `stickyHeaderIndices` on the ScrollView. The navigator's
 *    `max-height: calc(100vh - 100px); overflow: auto` survives as a real
 *    height off `useWindowDimensions()` plus a ScrollView
 *    (`questionNavigatorScroll` / `questionNavigatorScrollContent`).
 *  - `position: fixed` (.sidebar, .toast, .mobile-nav, .modal-backdrop, and
 *    `.page-heading > button` at <=760, which floats as `pageHeadingFab`):
 *    modelled as `position: 'absolute'` inside a full-screen root view. The FAB
 *    therefore has to be a sibling of the page ScrollView, not a child of
 *    `pageHeading`.
 *  - `overflow: auto` / `scroll-snap-*`: becomes a ScrollView. The metric strip,
 *    journey strip, heatmap, principal matrix and resource table are horizontal
 *    ScrollViews on phones; `snapToAlignment="start"` restores the snap.
 *  - `min-height: 100vh` / `100vw` / `clamp()` / `vw` padding: replaced with
 *    `flex: 1` and per-breakpoint constants resolved from `useWindowDimensions`.
 *  - `env(safe-area-inset-bottom)` on .mobile-nav: add
 *    `useSafeAreaInsets().bottom` to `mobileNav.paddingBottom` at the call site.
 *  - `writing-mode: vertical-rl` on the compact heatmap column labels: dropped;
 *    the labels shrink to 7px and the grid scrolls horizontally instead.
 *
 * SELECTORS
 *  - `:hover` / `:focus-visible`: every hover rule is exported as a separate
 *    `*Hover` style to merge from a Pressable's `({ hovered, pressed })`.
 *  - `::before` / `::after`: promoted to real elements - `checklistBullet`,
 *    `timelineConnector`, `loginDividerRule`, `demoDividerRule`,
 *    `reviewQuestionCardDot`, `gapFunnelFill`, `stageCycleConnector`,
 *    `personaPanelBullet`.
 *  - `:nth-child()` / `:last-child` (five-stage sections, table rows, matrix
 *    cells): apply the indexed style in JS - `fiveStageHeaderOne..Five`,
 *    `trLast`, `resourceRowLast`.
 *  - `!important`: no equivalent; order the style array so the winner is last.
 *  - Descendant selectors (`.card h2`, `.metric b`): each becomes its own named
 *    style (`cardTitle`, `metricValue`) since RN styles do not cascade.
 *
 * PAINT
 *  - `box-shadow`: kept as RN's `boxShadow` string via `shadow()` / `ring()`.
 *    Add `elevation` on Android if you target the old architecture.
 *  - `linear-gradient` / `radial-gradient` / `conic-gradient`
 *    (.login-story, .demo-auth-story, .bar em, .chart i, .donut,
 *    .review-score-ring, .brand-document-header): collapsed to the dominant
 *    solid. Restore with `expo-linear-gradient`; the donut and score ring need
 *    `react-native-svg`.
 *  - `repeating-linear-gradient` rule lines (.paper-lines, .answer-script):
 *    collapsed to a flat surface; repeat a 1px View to restore.
 *  - `backdrop-filter: blur()` (.topbar, .modal-backdrop, .mkt-nav): dropped to
 *    an opaque background. `expo-blur`'s BlurView restores it.
 *  - `filter: brightness(0) invert(1)` on the footer/report logos: use
 *    `tintColor` on the Image instead.
 *  - `object-fit: contain/cover`: use `resizeMode` (Image) or `contentFit`
 *    (expo-image).
 *  - `outline` focus rings: RN 0.86 has `outlineWidth/Color/Style/Offset`, used
 *    for `matrixCellHover`; on native they render only on the new architecture.
 *  - `transition` / `@keyframes` (.upload-progress, .toast, .progress i):
 *    dropped. Reanimated covers them.
 *  - `@media (prefers-reduced-motion)`: check
 *    `AccessibilityInfo.isReduceMotionEnabled()` before animating.
 *  - `@media print` (.parent-dashboard): no RN concept; the parent report keeps
 *    its light, printable palette unconditionally.
 *
 * TYPE
 *  - `font-weight: 750 / 850`: RN accepts only hundreds - rounded to 700 / 800.
 *  - `letter-spacing` in `em`: RN wants px, so `letterSpacing(size, em)` does
 *    the multiplication at build time.
 *  - `line-height` unitless: multiplied by the font size, likewise.
 *  - `white-space: nowrap` + `text-overflow: ellipsis`: use the Text props
 *    `numberOfLines={1}` and `ellipsizeMode="tail"`.
 *  - `overflow-wrap: anywhere` (.dropzone small, .secure-link code): RN Text
 *    wraps by default; there is no per-character break.
 *  - cursive faces ("Segoe Print", "Comic Sans MS") for .handwriting and the
 *    marked-up answer script: no system equivalent on iOS/Android. Ship a font
 *    with `expo-font` or accept the default face.
 *  - `font-family: Georgia, serif` on the answer paper: use `Fonts.serif` from
 *    `@/shared/theme/tokens`.
 *
 * COLOUR
 *  - `Colors` carries the ten values `:root` declared. globals.css also used
 *    ~60 one-off tints; each is rebuilt here with `mix`/`tint`/`shade`/`alpha`,
 *    so it tracks the palette instead of drifting from it. Reconstructions are
 *    within a few units per channel of the CSS value.
 *  - `--purple: #7756a8` was never ported to `Colors`. It is also dead in the
 *    web cascade: `.ai-marking-panel`'s purple left border is overridden by a
 *    later `1px solid #e2e6ed` rule, and `.metric.purple` is never rendered. It
 *    is therefore not reproduced.
 *  - The review-workspace violet (#5540da, #6547e8, #5c45e5, #4f3ed5) has no
 *    counterpart in `Colors`, so the navigator rail, question bullet and AI
 *    score render in `navy`.
 *  - The traffic-light matrix (#18a443 / #ffd52b / #ff9418 / #e51c23) maps onto
 *    green / a lightened orange (`amberLift`) / orange / red. Four tiers stay
 *    distinguishable; the two middle ones are less saturated than on the web.
 *  - The marketing `--m-*` sub-palette (#14356b, #e8a33d, #0f1b2d, #fbf8f3,
 *    #d9d4ca) is six brand colours the app palette does not carry. Rather than
 *    invent near-misses they map to navy / orange / a shaded navy / background /
 *    a warmed border. The marketing page therefore shares the app's palette.
 *  - `.parent-dashboard` is deliberately theme-independent on the web (it is
 *    printed and shared with parents), so its styles here use the light values
 *    in both schemes.
 * ------------------------------------------------------------------------- */
