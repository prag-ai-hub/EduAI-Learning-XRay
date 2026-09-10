/**
 * The public landing page.
 *
 * Ported from frontend/app/ui/MarketingHome.tsx. Every word it renders comes
 * from `@/features/marketing/lib/copy`, and its three illustrations are already
 * their own components, so what is left here is the page: fifteen sections, in
 * the order the web served them.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTES - the web constructs with no React Native counterpart
 * ---------------------------------------------------------------------------
 * 1. `position: sticky` on `.mkt-nav`. The nav is a sibling of the ScrollView
 *    rather than its first child, which is the only way it stays put while the
 *    page moves.
 *
 * 2. In-page anchors (`href="#how"`, `html{scroll-behavior:smooth}`). Each
 *    anchored section records its offset on layout and the link scrolls the
 *    page there, animated - the same movement the browser made.
 *
 * 3. `overflow: auto` on `.stage-cycle` and `.timeline` below 1000px. Both
 *    become a horizontal ScrollView at that width and stay a plain flex row
 *    above it, because the cards are `1fr` there and a horizontal scroller
 *    sizes to content rather than to the viewport.
 *
 * 4. `<details>/<summary>` in the FAQ. Held open per item in state; the web
 *    allowed several open at once, so this does too.
 *
 * 5. `mailto:` links. `Linking.openURL` opens the mail client on all three
 *    platforms, which is what the anchor did.
 *
 * Where the visitor goes on sign in, privacy and terms is a route's decision,
 * so those three are callbacks - the same reason `LegalPage` takes them.
 *
 * Every value comes from `@/shared/theme/styles`; the marketing page has its
 * own button rules (`.mkt-primary`, `.mkt-secondary`) rather than the app's
 * `.primary`, so it composes those keys instead of `AppButton`.
 */

import { useCallback, useRef, useState, type ReactNode } from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type ViewStyle,
} from 'react-native';

import { HeatGrid } from '@/features/marketing/components/heat-grid';
import { ParentPhone } from '@/features/marketing/components/parent-phone';
import { XrayReveal } from '@/features/marketing/components/xray-reveal';
import {
  authorityHeader,
  authorityRows,
  brand,
  contactEmail,
  explainer,
  faq,
  faqHeader,
  finalCta,
  founding,
  heatHeader,
  hero,
  howHeader,
  personas,
  personasHeader,
  pricing,
  rolloutHeader,
  rolloutWeeks,
  safety,
  stages,
  stagesClosingLine,
  worksHeader,
  worksWith,
  type PersonaKey,
} from '@/features/marketing/lib/copy';
import { BrandLogo } from '@/shared/components/brand';
import { Breakpoints, FontSize, Grid, Space, useAppStyles } from '@/shared/theme/styles';
import { Colors } from '@/shared/theme/tokens';

/** The five `id`s the page links to itself by. */
type Anchor = 'top' | 'heatmap' | 'how' | 'safety' | 'faq';

const FILL = { flex: 1 } as const;
/** `.mkt-primary` is `inline-flex`: it hugs its label instead of filling a column. */
const INLINE = { alignSelf: 'flex-start' } as const satisfies ViewStyle;
/** `.persona-tabs button` puts its glyph beside the label; `personaTab` only centres. */
const TAB_ROW = { flexDirection: 'row', alignItems: 'center', gap: Space.s9 } as const satisfies ViewStyle;
/** `.persona-tabs i` - the glyph is larger than the label it sits next to. */
const TAB_ICON = { fontSize: FontSize.f18 } as const;
/**
 * `.mkt-nav>div>a:not(.nav-signin){display:none}` below 680px - the sign-in
 * pill survives the phone layout, so its label must not take `mktNavLink`'s
 * `display: none` with the rest of the nav.
 */
const SHOWN = { display: 'flex' } as const satisfies ViewStyle;

export type MarketingHomeProps = {
  /** `href="/signin"` - the nav pill, both hero calls to action and the closing link. */
  onSignIn: () => void;
  /** The two footer links. */
  onPrivacy: () => void;
  onTerms: () => void;
};

export function MarketingHome({ onSignIn, onPrivacy, onTerms }: MarketingHomeProps) {
  const s = useAppStyles();
  const { width } = useWindowDimensions();
  const mktWide = width > Breakpoints.mktMedium;

  const [persona, setPersona] = useState<PersonaKey>('Teacher');
  const active = personas[persona];

  const scroller = useRef<ScrollView>(null);
  const offsets = useRef<Record<Anchor, number>>({ top: 0, heatmap: 0, how: 0, safety: 0, faq: 0 });

  const mark = useCallback(
    (anchor: Anchor) => (event: LayoutChangeEvent) => {
      offsets.current[anchor] = event.nativeEvent.layout.y;
    },
    [],
  );

  const jump = useCallback((anchor: Anchor) => {
    scroller.current?.scrollTo({ y: offsets.current[anchor], animated: true });
  }, []);

  const mail = useCallback((subject?: string) => {
    const query = subject ? `?subject=${encodeURIComponent(subject)}` : '';
    void Linking.openURL(`mailto:${contactEmail}${query}`);
  }, []);

  const personaKeys = Object.keys(personas) as PersonaKey[];

  return (
    <View style={s.mkt}>
      {/* `position: sticky; top: 0` - outside the scroller, so it stays. */}
      <View style={s.mktNav}>
        <Pressable
          role="link"
          accessibilityLabel={`${brand.title}, back to top`}
          onPress={() => jump('top')}
          style={s.mktBrand}>
          <BrandLogo style={s.mktBrandLogo} />
          <View style={s.mktBrandDivider}>
            <Text style={s.mktBrandName}>{brand.title}</Text>
            <Text style={s.mktBrandCaption}>{brand.company}</Text>
          </View>
        </Pressable>
        <View style={s.mktNavLinks}>
          <Pressable role="link" onPress={() => jump('how')}>
            <Text style={s.mktNavLink}>How it works</Text>
          </Pressable>
          <Pressable role="link" onPress={() => jump('safety')}>
            <Text style={s.mktNavLink}>Safety</Text>
          </Pressable>
          <Pressable role="link" onPress={() => jump('faq')}>
            <Text style={s.mktNavLink}>FAQ</Text>
          </Pressable>
          <Pressable role="link" onPress={onSignIn} style={s.navSignin}>
            <Text style={[s.mktNavLink, SHOWN]}>Sign in</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView ref={scroller} style={FILL}>
        {/* ---------------------------------------------------------- hero */}
        <View style={s.mktHero} onLayout={mark('top')}>
          <View style={s.heroCopy}>
            <Text style={s.mktEyebrow}>{hero.eyebrow}</Text>
            <Text accessibilityRole="header" style={s.heroTitle}>
              {hero.heading}
            </Text>
            <Text style={s.heroLead}>{hero.lead}</Text>
            <View style={s.trustStrip}>
              {hero.trust.map((point) => (
                <Text key={point} style={s.trustStripItem}>
                  {point}
                </Text>
              ))}
            </View>
            <View style={s.heroActions}>
              <MktButton title={hero.primaryCta} onPress={onSignIn} />
              <Pressable role="link" onPress={() => jump('heatmap')}>
                <Text style={s.mktLink}>{hero.secondaryCta}</Text>
              </Pressable>
            </View>
            <Text style={s.micro}>{hero.micro}</Text>
          </View>
          <XrayReveal />
        </View>

        {/* ----------------------------------------------------- explainer */}
        {/* The web's three grid children auto-placed into two columns, which
            put the heading in the right-hand one and the prose in the left.
            React Native has no auto-placement; the two columns keep their
            `.9fr / 1.1fr` weights with the heading leading, which is the
            reading order the copy was written in. */}
        <View style={s.explainer}>
          <View style={Grid.track(0.9)}>
            <Text style={[s.mktEyebrow, s.mktEyebrowOnNavy]}>{explainer.eyebrow}</Text>
            <Text accessibilityRole="header" style={s.explainerTitle}>
              {explainer.heading}
            </Text>
          </View>
          <View style={Grid.track(1.1)}>
            {explainer.paragraphs.map((paragraph) => (
              <Text key={paragraph} style={s.explainerBody}>
                {paragraph}
              </Text>
            ))}
          </View>
        </View>

        {/* ------------------------------------------------------ personas */}
        <View style={[s.mktSection, s.personas]}>
          <SectionHeader eyebrow={personasHeader.eyebrow} heading={personasHeader.heading} />
          <View style={s.personaTabs} role="tablist">
            {personaKeys.map((key) => {
              const selected = key === persona;
              return (
                <Pressable
                  key={key}
                  role="tab"
                  accessibilityState={{ selected }}
                  accessibilityLabel={key}
                  onPress={() => setPersona(key)}
                  style={[s.personaTab, TAB_ROW, selected && s.personaTabSelected]}>
                  <Text
                    accessibilityElementsHidden
                    style={[s.personaTabText, selected && s.personaTabTextSelected, TAB_ICON]}>
                    {personas[key].icon}
                  </Text>
                  <Text style={[s.personaTabText, selected && s.personaTabTextSelected]}>{key}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={s.personaPanel}>
            <View style={s.personaPanelIntro}>
              <Text style={s.personaPanelKicker}>For {persona}</Text>
              <Text accessibilityRole="header" style={s.personaPanelTitle}>
                {active.title}
              </Text>
            </View>
            <View style={s.personaPanelBody}>
              {active.points.map((point) => (
                <View key={point} style={s.personaPanelItem}>
                  {/* `li:before{content:"✓"}` - decoration, so it is not read out. */}
                  <Text accessibilityElementsHidden style={s.personaPanelBullet}>
                    ✓
                  </Text>
                  <Text style={[s.personaPanelItemText, FILL]}>{point}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* ------------------------------------------------------- heatmap */}
        <View style={[s.mktSection, s.heatSection]} onLayout={mark('heatmap')}>
          <SectionHeader eyebrow={heatHeader.eyebrow} heading={heatHeader.heading} />
          <HeatGrid />
        </View>

        {/* -------------------------------------------------- how it works */}
        <View style={s.mktSection} onLayout={mark('how')}>
          <SectionHeader eyebrow={howHeader.eyebrow} heading={howHeader.heading} />
          <Scroller horizontal={!mktWide}>
            <View style={s.stageCycle}>
              {/* `.stage-cycle:before` - the rule the five stages sit on. */}
              <View style={s.stageCycleConnector} />
              {stages.map(([name, body, signoff], index) => {
                // `.prove` - the fifth stage, the one the section is about.
                const prove = index === stages.length - 1;
                return (
                  <View key={name} style={[s.stageCard, prove && s.stageCardActive]}>
                    <View style={[s.stageCardIndex, prove && s.stageCardIndexActive]}>
                      <Text style={s.stageCardIndexText}>{index + 1}</Text>
                    </View>
                    <Text
                      accessibilityRole="header"
                      style={[s.stageCardTitle, prove && s.stageCardTitleActive]}>
                      {name}
                    </Text>
                    <Text style={[s.stageCardBody, prove && s.stageCardBodyActive]}>{body}</Text>
                    <View style={s.stageCardTag}>
                      <Text style={s.stageCardTagText}>{signoff}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </Scroller>
          <Text style={s.closingLine}>{stagesClosingLine}</Text>
        </View>

        {/* ----------------------------------------------------- authority */}
        <View style={[s.mktSection, s.authority]}>
          <SectionHeader eyebrow={authorityHeader.eyebrow} heading={authorityHeader.heading} />
          <View style={s.authorityTable}>
            <View style={[s.authorityRow, s.authorityHead]}>
              <View style={[s.authorityCell, s.authorityHeadLead]}>
                <Text style={s.authorityHeadText}>Never</Text>
              </View>
              <View style={s.authorityCell}>
                <Text style={s.authorityHeadText}>Always</Text>
              </View>
            </View>
            {authorityRows.map(([never, always]) => (
              <View key={never} style={s.authorityRow}>
                <View style={[s.authorityCell, s.authorityCellLead]}>
                  <Text style={s.authorityCellLeadText}>{never}</Text>
                </View>
                <View style={[s.authorityCell, s.authorityCellValue]}>
                  <Text style={s.authorityCellValueText}>{always}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* ------------------------------------------------ founding cohort */}
        <View style={[s.mktSection, s.founding]}>
          <View style={s.foundingCopy}>
            <Text style={s.mktEyebrow}>{founding.eyebrow}</Text>
            <Text accessibilityRole="header" style={s.mktSectionTitle}>
              {founding.heading}
            </Text>
            <Text style={s.foundingBody}>{founding.body}</Text>
            <MktButton title={founding.cta} onPress={() => mail(founding.ctaSubject)} inline />
          </View>
          <ParentPhone />
        </View>

        {/* ----------------------------------------------------- works with */}
        <View style={s.mktSection}>
          <SectionHeader eyebrow={worksHeader.eyebrow} heading={worksHeader.heading} />
          <View style={s.featureGrid}>
            {worksWith.map((item, index) => (
              <View key={item} style={[s.featureTrack, s.featureCard]}>
                <Text style={s.featureCardKicker}>0{index + 1}</Text>
                <Text style={s.featureCardBody}>{item}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* --------------------------------------------------------- safety */}
        <View style={[s.mktSection, s.safety]} onLayout={mark('safety')}>
          <View style={s.safetyCopy}>
            <Text style={[s.mktEyebrow, s.mktEyebrowOnNavy]}>{safety.eyebrow}</Text>
            <Text accessibilityRole="header" style={s.explainerTitle}>
              {safety.heading}
            </Text>
            <Text style={s.safetyBody}>{safety.body}</Text>
          </View>
          <View style={s.safetySeal}>
            <View style={s.safetySealIcon}>
              <Text style={s.safetySealIconText}>✓</Text>
            </View>
            <Text style={s.safetySealTitle}>{safety.seal.title}</Text>
            <Text style={s.safetySealCaption}>{safety.seal.note}</Text>
          </View>
        </View>

        {/* -------------------------------------------------------- rollout */}
        <View style={s.mktSection}>
          <SectionHeader eyebrow={rolloutHeader.eyebrow} heading={rolloutHeader.heading} />
          <Scroller horizontal={!mktWide}>
            <View style={s.rolloutTimeline}>
              {rolloutWeeks.map(([week, work, cost]) => (
                <View key={week} style={s.rolloutCard}>
                  <Text style={s.rolloutCardTitle}>Week {week}</Text>
                  <Text style={s.rolloutCardBody}>{work}</Text>
                  <View style={s.rolloutCardTag}>
                    <Text style={s.rolloutCardTagText}>{cost}</Text>
                  </View>
                </View>
              ))}
            </View>
          </Scroller>
        </View>

        {/* -------------------------------------------------------- pricing */}
        <View style={[s.mktSection, s.pricing]}>
          <View style={s.pricingCopy}>
            <Text style={s.mktEyebrow}>{pricing.eyebrow}</Text>
            <Text accessibilityRole="header" style={s.mktSectionTitle}>
              {pricing.heading}
            </Text>
            <Text style={s.foundingBody}>{pricing.body}</Text>
          </View>
          <MktButton
            title={pricing.cta}
            onPress={() => mail(pricing.ctaSubject)}
            variant="light"
            inline
          />
        </View>

        {/* ------------------------------------------------------------ faq */}
        <View style={[s.mktSection, s.faq]} onLayout={mark('faq')}>
          <SectionHeader eyebrow={faqHeader.eyebrow} heading={faqHeader.heading} />
          {faq.map(([question, answer]) => (
            <FaqItem key={question} question={question} answer={answer} />
          ))}
        </View>

        {/* ------------------------------------------------------ final cta */}
        <View style={s.finalCta}>
          <Text style={s.mktEyebrow}>{finalCta.eyebrow}</Text>
          <Text accessibilityRole="header" style={s.finalCtaTitle}>
            {finalCta.heading}
          </Text>
          <View style={s.finalCtaActions}>
            <MktButton title={finalCta.primary} onPress={onSignIn} />
            <MktButton
              title={finalCta.secondary}
              onPress={() => mail(finalCta.secondarySubject)}
              variant="secondary"
            />
          </View>
          <Pressable role="link" onPress={onSignIn}>
            <Text style={s.finalSignin}>{finalCta.signin}</Text>
          </Pressable>
        </View>

        {/* --------------------------------------------------------- footer */}
        <View style={s.mktFooter}>
          {/* `filter: brightness(0) invert(1)` - a white knockout of the mark. */}
          <BrandLogo style={s.mktFooterLogo} tintColor={Colors.light.background} />
          <Text style={s.mktFooterText}>{brand.footerLine}</Text>
          <View style={s.mktFooterNav}>
            <Pressable role="link" onPress={onPrivacy}>
              <Text style={s.mktFooterLink}>Privacy</Text>
            </Pressable>
            <Pressable role="link" onPress={onTerms}>
              <Text style={s.mktFooterLink}>Terms</Text>
            </Pressable>
            <Pressable role="link" onPress={() => mail()}>
              <Text style={s.mktFooterLink}>Contact</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

/** `.mkt-section>header` - the eyebrow and heading every section opens with. */
function SectionHeader({ eyebrow, heading }: { eyebrow: string; heading: string }) {
  const s = useAppStyles();
  return (
    <View style={s.mktSectionHeader}>
      <Text style={s.mktEyebrow}>{eyebrow}</Text>
      <Text accessibilityRole="header" style={s.mktSectionTitle}>
        {heading}
      </Text>
    </View>
  );
}

/**
 * `.mkt-primary`, `.mkt-primary.light` and `.mkt-secondary`.
 *
 * The marketing page never used the app's `.primary`, so this composes the
 * marketing keys rather than `AppButton`. `:hover` has no touch equivalent, so
 * the lift doubles as the pressed state - the convention `AppButton` set.
 */
function MktButton({
  title,
  onPress,
  variant = 'primary',
  inline,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'light' | 'secondary';
  inline?: boolean;
}) {
  const s = useAppStyles();
  const secondary = variant === 'secondary';
  const light = variant === 'light';
  return (
    <Pressable
      role="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ hovered, pressed }) => [
        secondary ? s.mktSecondary : s.mktPrimary,
        light && s.mktPrimaryLight,
        !secondary && (hovered || pressed) && s.mktPrimaryHover,
        inline && INLINE,
      ]}>
      <Text style={[secondary ? s.mktSecondaryText : s.mktPrimaryText, light && s.mktPrimaryLightText]}>
        {title}
      </Text>
    </Pressable>
  );
}

/** One `<details>`: the question, the ＋, and the answer once it is open. */
function FaqItem({ question, answer }: { question: string; answer: string }) {
  const s = useAppStyles();
  const [open, setOpen] = useState(false);
  return (
    <View style={s.faqItem}>
      <Pressable
        role="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={question}
        onPress={() => setOpen(!open)}
        style={s.faqSummary}>
        <Text style={s.faqSummaryText}>{question}</Text>
        <Text accessibilityElementsHidden style={s.faqSummaryIcon}>
          {open ? '−' : '+'}
        </Text>
      </Pressable>
      {open ? <Text style={s.faqBody}>{answer}</Text> : null}
    </View>
  );
}

/**
 * `overflow: auto` below 1000px, a plain block above it.
 *
 * A horizontal ScrollView sizes its content, so wrapping the wide layout in one
 * would collapse five `1fr` cards onto their intrinsic widths.
 */
function Scroller({ horizontal, children }: { horizontal: boolean; children: ReactNode }) {
  if (!horizontal) return <>{children}</>;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      {children}
    </ScrollView>
  );
}
