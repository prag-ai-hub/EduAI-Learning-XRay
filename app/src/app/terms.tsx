/**
 * /terms.
 *
 * Ported from frontend/app/terms/page.tsx. The document itself is
 * `TermsDocument`; both of its links went to `/` on the web, and where that is
 * belongs to the route, so the route supplies it.
 */

import { useRouter } from 'expo-router';

import { TermsDocument } from '@/features/legal/components/legal-page';

export default function TermsRoute() {
  const router = useRouter();
  return <TermsDocument onHome={() => router.replace('/')} />;
}
