/**
 * `/` - the public landing page.
 *
 * A route file, so it stays thin: it renders the screen and answers the three
 * navigation questions the screen deliberately does not know. `MarketingHome`
 * takes callbacks rather than hrefs because a feature component has no business
 * knowing the route tree - the same rule `signOut` and `LegalPage` follow.
 */

import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import { MarketingHome } from '@/features/marketing/components/home';

export default function LandingRoute() {
  const router = useRouter();

  return (
    <MarketingHome
      onSignIn={useCallback(() => router.push('/signin'), [router])}
      onPrivacy={useCallback(() => router.push('/privacy'), [router])}
      onTerms={useCallback(() => router.push('/terms'), [router])}
    />
  );
}
