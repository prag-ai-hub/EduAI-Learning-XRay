/**
 * The privacy and terms pages.
 *
 * Ported from frontend/app/privacy/page.tsx and frontend/app/terms/page.tsx,
 * which were one-line components sharing the `.legal-page` stylesheet.
 *
 * The copy is kept word for word, including the parts that describe the product
 * as a demonstration and say that data is stored in the browser. That is a
 * statement about how the product currently behaves, not styling, and changing
 * it during a port would be changing what the company tells its users.
 *
 * The back link and the closing action both navigated to `/` on the web. Where
 * that goes is a route's decision, so both are callbacks here and the route
 * file supplies the navigation.
 */

import type { ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { AppButton, LinkButton } from '@/shared/components/buttons';
import { BrandLogo } from '@/shared/components/brand';
import { Eyebrow } from '@/shared/components/primitives';
import { useAppStyles } from '@/shared/theme/styles';

const FILL = { flex: 1 } as const;
const MIN_FULL_HEIGHT = { flexBasis: 'auto', flexShrink: 0 } as const;

export type LegalPageProps = {
  eyebrow: string;
  title: string;
  /** `← Back to sign in`. */
  onBack: () => void;
  backLabel?: string;
  /** The closing `.primary.legal-action` button. */
  actionLabel?: string;
  onAction: () => void;
  children: ReactNode;
};

/** `.legal-page` - the narrow single-column document shell. */
export function LegalPage({
  eyebrow,
  title,
  onBack,
  backLabel = '← Back to sign in',
  actionLabel = 'Return to sign in',
  onAction,
  children,
}: LegalPageProps) {
  const s = useAppStyles();
  return (
    // `.legal-page` is `flex: 1`; a content container with a zero basis would
    // clamp to the viewport and never scroll, so the basis is restored.
    <ScrollView style={FILL} contentContainerStyle={[s.legalPage, MIN_FULL_HEIGHT]}>
      <LinkButton title={backLabel} onPress={onBack} textStyle={s.legalBack} />
      <BrandLogo style={s.legalLogo} />
      <Eyebrow>{eyebrow}</Eyebrow>
      <Text accessibilityRole="header" style={s.legalTitle}>
        {title}
      </Text>
      {children}
      <View style={s.legalAction}>
        <AppButton title={actionLabel} variant="primary" onPress={onAction} />
      </View>
    </ScrollView>
  );
}

/** One `<h2>` and the paragraphs under it. */
function Section({ heading, body }: { heading: string; body: string }) {
  const s = useAppStyles();
  return (
    <>
      <Text accessibilityRole="header" style={s.legalHeading}>
        {heading}
      </Text>
      <Text style={s.legalBody}>{body}</Text>
    </>
  );
}

export function PrivacyDocument({ onHome }: { onHome: () => void }) {
  const s = useAppStyles();
  return (
    <LegalPage
      eyebrow="Privacy"
      title="Student evidence deserves careful protection."
      onBack={onHome}
      onAction={onHome}>
      <Text style={s.legalBody}>
        EduAI Learning X-Ray is designed for authorised school use. Student work remains private, AI
        suggestions require teacher review, and identifiable student information is not used for
        advertising or public ranking.
      </Text>
      <Section
        heading="Demo data"
        body="This demonstration stores created assessments, invitations, interventions and preferences locally in your browser. You can clear them from Activity & audit inside the application."
      />
      <Section
        heading="Responsible AI"
        body="AI simulations expose confidence and evidence. They do not diagnose sensitive traits or make promotion, detention or streaming decisions."
      />
    </LegalPage>
  );
}

export function TermsDocument({ onHome }: { onHome: () => void }) {
  const s = useAppStyles();
  return (
    <LegalPage
      eyebrow="Terms"
      title="Teacher authority remains central."
      onBack={onHome}
      onAction={onHome}>
      <Text style={s.legalBody}>
        This is an interactive product demonstration. Generated grades, diagnoses, interventions and
        reports are simulated and must not be used for high-stakes academic decisions.
      </Text>
      <Section
        heading="Authorised use"
        body="Only upload information you are authorised to process. Teachers remain responsible for approving marks, concept classifications, groups, interventions and reports."
      />
      <Section
        heading="Prohibited use"
        body="Do not use the product to rank teachers or students, infer sensitive personal attributes, or make automatic promotion, detention or stream-allocation decisions."
      />
    </LegalPage>
  );
}
