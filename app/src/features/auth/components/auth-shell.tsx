/**
 * The two-pane authentication layout, and the two pieces every auth screen
 * repeats inside it.
 *
 * Three screens shared this shape on the web and each had its own copy:
 * `TeacherAuth` (frontend/app/ui/FunctionalEduAIApp.tsx:414-419, `.demo-auth`),
 * frontend/app/signin/page.tsx and frontend/app/register-school/page.tsx (both
 * `.login-page`). The markup is the same - a navy story pane, a white card
 * pane, three numbered proof points - and only the stylesheet differs, so
 * `variant` selects between the two rule sets and nothing is restyled.
 *
 * The story pane is decoration with real copy in it, so it stays above the card
 * on a phone exactly as both stylesheets already stacked it.
 */

import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { AppButton, ButtonRow } from '@/shared/components/buttons';
import { BrandLogo } from '@/shared/components/brand';
import { Eyebrow } from '@/shared/components/primitives';
import { useAppStyles } from '@/shared/theme/styles';

const FILL = { flex: 1 } as const;
/** Grow to the viewport, but let taller content scroll instead of clamping. */
const MIN_FULL_HEIGHT = { flexBasis: 'auto', flexShrink: 0 } as const;

/** `.demo-auth` (the in-app profile gate) or `.login-page` (the public pages). */
export type AuthVariant = 'demo' | 'login';

/** One numbered proof point. `caption` is used by the login variant only. */
export type AuthProofPoint = {
  badge: string;
  title: string;
  caption?: string;
};

export type AuthShellProps = {
  variant?: AuthVariant;
  eyebrow: string;
  title: string;
  lead: string;
  proof?: readonly AuthProofPoint[];
  /** Accessible name of the story pane, as `aria-label` was on the web. */
  storyLabel?: string;
  /** Accessible name of the card pane. */
  panelLabel?: string;
  /** The card's contents - heading, form, buttons, footer. */
  children: ReactNode;
};

export function AuthShell({
  variant = 'demo',
  eyebrow,
  title,
  lead,
  proof,
  storyLabel,
  panelLabel,
  children,
}: AuthShellProps) {
  const s = useAppStyles();
  const login = variant === 'login';

  return (
    // One scroller for both panes, as the web page scrolled as a whole. The
    // basis override is what makes that work: `.login-page` and `.demo-auth`
    // are `flex: 1`, and a content container with a zero basis clamps to the
    // viewport and never scrolls. `flexBasis: 'auto'` with the grow kept is
    // exactly the CSS's `min-height: 100vh`.
    <ScrollView
      style={FILL}
      contentContainerStyle={[login ? s.loginPage : s.demoAuth, MIN_FULL_HEIGHT]}>
      <View style={login ? s.loginStory : s.demoAuthStory} accessibilityLabel={storyLabel}>
        <View style={login ? s.loginStoryInner : undefined}>
          <BrandLogo style={login ? s.loginLogo : s.demoAuthLogo} />
          <Eyebrow onNavy>{eyebrow}</Eyebrow>
          <Text accessibilityRole="header" style={login ? s.loginTitle : s.demoAuthTitle}>
            {title}
          </Text>
          <Text style={login ? s.loginLead : s.demoAuthLead}>{lead}</Text>

          {proof?.length ? (
            <View style={login ? s.loginProof : { gap: 10, marginTop: 24 }}>
              {proof.map((point) =>
                login ? (
                  <View key={point.badge} style={s.loginProofCard}>
                    <Text style={s.loginProofBadge}>{point.badge}</Text>
                    <View style={s.loginProofBody}>
                      <Text style={s.loginProofTitle}>{point.title}</Text>
                      {point.caption ? (
                        <Text style={s.loginProofCaption}>{point.caption}</Text>
                      ) : null}
                    </View>
                  </View>
                ) : (
                  <View key={point.badge} style={s.demoAuthStep}>
                    <View style={s.demoAuthStepIndex}>
                      <Text style={s.demoAuthStepIndexText}>{point.badge}</Text>
                    </View>
                    <Text style={s.demoAuthStepLabel}>{point.title}</Text>
                  </View>
                ),
              )}
            </View>
          ) : null}
        </View>
      </View>

      <View style={login ? s.loginPanel : s.demoAuthPanel} accessibilityLabel={panelLabel}>
        <View style={login ? s.loginCard : s.demoAuthCard}>
          {login ? <BrandLogo style={s.loginMobileLogo} /> : null}
          {children}
        </View>
      </View>
    </ScrollView>
  );
}

/**
 * `.demo-divider` / `.login-divider` - a rule with a caption in the middle.
 *
 * The web drew it with `::before`/`::after` pseudo-elements, which React Native
 * has none of; two flexed `View`s either side of the text are the same picture.
 */
export function AuthDivider({
  children,
  variant = 'demo',
}: {
  children: string;
  variant?: AuthVariant;
}) {
  const s = useAppStyles();
  const login = variant === 'login';
  return (
    <View style={login ? s.loginDivider : s.demoDivider}>
      <View style={login ? s.loginDividerRule : s.demoDividerRule} />
      <Text style={login ? s.loginDividerText : s.demoDividerText}>{children}</Text>
      <View style={login ? s.loginDividerRule : s.demoDividerRule} />
    </View>
  );
}

export type OAuthButtonRowProps = {
  variant?: AuthVariant;
  onGoogle: () => void;
  onMicrosoft: () => void;
  /**
   * `.provider-grid`'s third card, "Use email and password". On the web it
   * focused the email input; `form.tsx` has no `focusField`, so the caller
   * decides what it does - scroll to the form, or nothing.
   */
  onEmail?: () => void;
  disabled?: boolean;
};

/**
 * The federated sign-in choices.
 *
 * `demo` is the two-button `.button-row` the in-app gate used; `login` is the
 * three-card `.provider-grid` from /signin. Same providers, two presentations,
 * both already in the stylesheet.
 */
export function OAuthButtonRow({
  variant = 'demo',
  onGoogle,
  onMicrosoft,
  onEmail,
  disabled,
}: OAuthButtonRowProps) {
  const s = useAppStyles();

  if (variant === 'demo') {
    return (
      <ButtonRow>
        <AppButton title="Google" onPress={onGoogle} disabled={disabled} />
        <AppButton title="Microsoft" onPress={onMicrosoft} disabled={disabled} />
      </ButtonRow>
    );
  }

  return (
    <View style={s.providerGrid} accessibilityLabel="Supported school sign-in providers">
      <ProviderCard glyph="G" label="Continue with Google" onPress={onGoogle} disabled={disabled} />
      <ProviderCard
        glyph="⊞"
        label="Continue with Microsoft"
        onPress={onMicrosoft}
        disabled={disabled}
      />
      {onEmail ? <ProviderCard glyph="@" label="Use email and password" onPress={onEmail} /> : null}
    </View>
  );
}

/** `.provider-grid button` - the glyph over its caption, or beside it on a phone. */
function ProviderCard({
  glyph,
  label,
  onPress,
  disabled,
}: {
  glyph: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const s = useAppStyles();
  return (
    <Pressable
      role="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ hovered, pressed }) => [
        s.providerCard,
        (hovered || pressed) && s.providerCardHover,
        disabled && s.disabled,
      ]}>
      <Text style={s.providerCardTitle} accessibilityElementsHidden>
        {glyph}
      </Text>
      <Text style={s.providerCardCaption}>{label}</Text>
    </Pressable>
  );
}
