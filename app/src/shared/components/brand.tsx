/**
 * The brand marks, and the splash they appear on.
 *
 * Ported from the `<img src="/brand/logo.png">` and `<img src="/brand/shield.png">`
 * call sites in frontend/ - the sidebar and mobile brand
 * (FunctionalEduAIApp.tsx:341, 350), the three `.app-loading` splashes (286,
 * 298, 335), `BrandDocumentHeader` (1710), the marketing nav and footer, the
 * two auth pages, the legal pages and the parent dashboard.
 *
 * ---------------------------------------------------------------------------
 * Why this is one file
 * ---------------------------------------------------------------------------
 *
 * `/brand/logo.png` is a public-directory URL. It resolves on a web server and
 * resolves to nothing on a phone, so every one of those call sites has to
 * become a `require()`d asset that the bundler can see and ship. Doing that in
 * one place is the difference between two asset references and fourteen.
 *
 * The other thing that cannot cross over is `height: auto`. React Native gives
 * an `<Image>` no intrinsic size, so a style that sets only a width - which is
 * what `appLoadingLogo`, `loginLogo` and `legalLogo` all do, exactly as the CSS
 * did - renders zero pixels tall. Each mark therefore carries its own
 * `aspectRatio`, read from the asset rather than hardcoded, and a width-only
 * style behaves the way the CSS did.
 *
 * Colours, spacing and every style key come from `@/shared/theme/styles`;
 * nothing here invents a value.
 */

import { Image, type ImageStyle, type StyleProp, Text, View, type ViewStyle } from 'react-native';

import { FontSize, FontWeight, useAppPalette, useAppStyles } from '@/shared/theme/styles';
import { Colors } from '@/shared/theme/tokens';

const LOGO = require('@/assets/brand/logo.png');
const SHIELD = require('@/assets/brand/shield.png');

/**
 * Intrinsic proportions, resolved once from the bundled assets. `resolveAssetSource`
 * knows the real pixel dimensions on every platform, so this stays correct if
 * either mark is redrawn.
 *
 * The fallback is not defensive padding, it is the SERVER. `app.json` sets
 * `web.output: "server"`, so Expo Router renders these routes in Node at build
 * and request time - and `Image.resolveAssetSource` does not exist there. This
 * runs at module scope, so an unguarded call did not degrade one image: it
 * threw while the module was being imported, and every route that reaches
 * `brand.tsx` - which is the landing page, both auth screens and the app shell
 * - failed to render at all.
 *
 * The literals are the marks' real dimensions, so the guarded path and the
 * resolved path agree; nothing looks different on the server.
 */
const LOGO_RATIO = ratioOf(LOGO, 1536 / 535);
const SHIELD_RATIO = ratioOf(SHIELD, 1);

function ratioOf(asset: number, fallback: number): number {
  if (typeof Image.resolveAssetSource !== 'function') return fallback;
  const resolved = Image.resolveAssetSource(asset);
  return resolved?.width && resolved?.height ? resolved.width / resolved.height : fallback;
}

export type BrandMarkProps = {
  /** Pass the theme key the original CSS used - `s.appLoadingLogo`, `s.loginLogo`, … */
  style?: StyleProp<ImageStyle>;
  /** `filter: brightness(0) invert(1)` on the dark document header. */
  tintColor?: string;
};

/** The full wordmark. `<img src="/brand/logo.png" alt="EduAI Hub">`. */
export function BrandLogo({ style, tintColor }: BrandMarkProps) {
  return (
    <Image
      source={LOGO}
      accessibilityLabel="EduAI Hub"
      resizeMode="contain"
      tintColor={tintColor}
      style={[{ aspectRatio: LOGO_RATIO }, style]}
    />
  );
}

/**
 * The square shield used where the wordmark will not fit - the sidebar brand
 * button and the compact top bar. Decorative in both, so it carries no label.
 */
export function BrandShield({ style, tintColor }: BrandMarkProps) {
  return (
    <Image
      source={SHIELD}
      accessibilityElementsHidden
      importantForAccessibility="no"
      resizeMode="contain"
      tintColor={tintColor}
      style={[{ aspectRatio: SHIELD_RATIO }, style]}
    />
  );
}

/**
 * The navy banner that heads an on-screen report so it reads as the same
 * artefact the exported PDF does.
 *
 * `.brand-document-header img` is `filter: brightness(0) invert(1)` - a white
 * knockout of the mark. RN has no filters, so it is a `tintColor` instead,
 * which is the same result for a single-colour knockout.
 */
export function BrandDocumentHeader({
  label,
  title,
  meta,
}: {
  label: string;
  title: string;
  meta: string;
}) {
  const s = useAppStyles();
  return (
    <View style={s.brandDocumentHeader}>
      <BrandLogo style={s.brandDocumentLogo} tintColor={Colors.light.background} />
      <View style={{ flex: 1 }}>
        <Text style={s.brandDocumentKicker}>{label}</Text>
        <Text style={s.brandDocumentTitle}>{title}</Text>
        <Text style={s.brandDocumentMeta}>{meta}</Text>
      </View>
      <View style={s.brandDocumentTag}>
        <Text style={s.brandDocumentTagText}>Teacher-reviewed AI support</Text>
      </View>
    </View>
  );
}

/**
 * The full-screen splash. Three screens render it - waiting for the session,
 * redirecting to sign-in, and restoring the workspace - each with its own line
 * of text, which is the only thing that ever differed between them.
 */
export function AppLoading({ message, style }: { message: string; style?: StyleProp<ViewStyle> }) {
  const s = useAppStyles();
  const p = useAppPalette();
  return (
    <View style={[s.appLoading, style]} accessibilityRole="progressbar" accessibilityLabel={message}>
      <BrandLogo style={s.appLoadingLogo} />
      {/* `.app-loading b` had no rule of its own: it inherited the body colour
          and the browser's bold at the root 16px. There is no such inheritance
          in React Native, so the three values are stated - from tokens, not as
          literals. */}
      <Text style={{ color: p.text, fontWeight: FontWeight.bold, fontSize: FontSize.f16 }}>
        {message}
      </Text>
    </View>
  );
}
