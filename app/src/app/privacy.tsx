/**
 * /privacy.
 *
 * Ported from frontend/app/privacy/page.tsx. The document itself is
 * `PrivacyDocument`; both of its links went to `/` on the web, and where that
 * is belongs to the route, so the route supplies it.
 */

import { useRouter } from 'expo-router';

import { PrivacyDocument } from '@/features/legal/components/legal-page';

export default function PrivacyRoute() {
  const router = useRouter();
  return <PrivacyDocument onHome={() => router.replace('/')} />;
}
