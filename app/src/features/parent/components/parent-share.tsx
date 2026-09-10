/**
 * Mint a signed, expiring link to one student's dashboard, and get it to that
 * student's parent.
 *
 * Ported from frontend/app/ui/ParentShareDialog.tsx. The dialog addresses one
 * child - the id it is opened with is `"<assessmentId>:<fileId>"` - and that is
 * the whole security model: a link is scoped to a single graded answer sheet, it
 * carries no account, and it stops working on the date shown under the QR code.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTES - four web idioms replaced
 * ---------------------------------------------------------------------------
 *  1. **The token.** The source read `sessionStorage.getItem("eduai-access-token")`
 *     and built its own `Authorization` header. That mirror no longer exists;
 *     `net.ts` owns the token, and `authFetch` is the one way to reach an
 *     `/api/*` route - it attaches the same bearer and retries once through a
 *     refresh on a 401, which a phone resumed hours later needs and a browser
 *     tab did not.
 *  2. **Copying.** `navigator.clipboard` / `document.execCommand("copy")` have
 *     no React Native equivalent and `expo-clipboard` is not a dependency of
 *     this app, so the button opens the platform share sheet
 *     (`Share.share({message})`) - which is how a link leaves an app on a
 *     device anyway. The link itself is `selectable`, so it can be copied by
 *     hand on any platform, which is what the source's fallback did too. The
 *     button therefore says "Share link" rather than "Copy link": it now does
 *     something visibly different, and a label that lied about that would be
 *     worse than the change.
 *  3. **`mailto:` and `wa.me` anchors** become `Linking.openURL`, which opens
 *     the mail client and WhatsApp on all three platforms.
 *  4. **The QR code** was an `<img>` pointing at api.qrserver.com. It is a
 *     remote `<Image>` with the same URL. Note what that means and has always
 *     meant: the share URL is sent to a third party to be drawn. Nothing about
 *     the port changes it, but it is the reason the "Open QR image" action is
 *     an ordinary external link rather than anything privileged.
 */

import { useState } from 'react';
import { Image, Linking, Share, Text, View } from 'react-native';

import { authFetch } from '@/features/auth/api/authApi';
import { AppButton, ButtonRow } from '@/shared/components/buttons';
import { Select } from '@/shared/components/form';
import { DialogHead } from '@/shared/components/primitives';
import { useAppStyles } from '@/shared/theme/styles';
import type { W } from '@/shared/types/workspace';

/** What POST /api/shares returns on success - all three fields always present. */
type ShareLink = { url: string; studentName: string; expiresAt: string };

const DURATIONS = [
  { label: '7 days', value: '7' },
  { label: '30 days', value: '30' },
  { label: '60 days', value: '60' },
  { label: '90 days', value: '90' },
];

function qrImageUrl(url: string): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=320x320&format=png&data=${encodeURIComponent(
    url,
  )}`;
}

export function ParentShareDialog({ state, id, done }: W<'state' | 'done'> & { id: string }) {
  const s = useAppStyles();
  const [assessmentId, fileId] = id.split(':');
  const assessment = state.assessments.find((item) => item.id === assessmentId);
  const result = assessment?.gradeResults?.[fileId];

  const [share, setShare] = useState<ShareLink | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState('30');
  const [status, setStatus] = useState('');

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await authFetch('/api/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessmentId, fileId, expiresInDays: Number(days) }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'QR code could not be created');
      setShare(payload as ShareLink);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'QR code could not be created');
    } finally {
      setBusy(false);
    }
  };

  if (!assessment || !result)
    return (
      <>
        <DialogHead eyebrow="Parent access" title="Student analysis unavailable" />
        <View role="alert" style={s.formError}>
          <Text style={s.formErrorText}>This student analysis could not be found.</Text>
        </View>
      </>
    );

  const studentName = result.studentName;

  /**
   * `Linking.openURL` rejects when nothing is registered for the scheme - no
   * mail client on a bare simulator, no WhatsApp on the device - so every call
   * says so rather than failing silently.
   */
  const openExternal = async (url: string, unavailable: string) => {
    setStatus('');
    try {
      await Linking.openURL(url);
    } catch {
      setStatus(unavailable);
    }
  };

  const shareLink = async () => {
    if (!share) return;
    setStatus('');
    try {
      await Share.share({ message: `${studentName} learning dashboard: ${share.url}` });
    } catch {
      setStatus('Sharing is not available here. Select the link above to copy it.');
    }
  };

  return (
    <>
      <DialogHead
        eyebrow="Student-specific parent access"
        title={`Share ${studentName}'s dashboard`}
      />
      <Text style={s.modalCopy}>
        Create a signed QR code for this student only. Parents can view reports without an account;
        the link expires automatically.
      </Text>

      {!share ? (
        <>
          {/* Unnamed and controlled: there is no <Form> here, exactly as the
              source had no <form>, and a named field outside one warns. */}
          <Select
            label="Access duration"
            options={DURATIONS}
            value={days}
            onValueChange={setDays}
          />
          {error ? (
            <View role="alert" style={s.formError}>
              <Text style={s.formErrorText}>{error}</Text>
            </View>
          ) : null}
          <AppButton
            variant="primary"
            full
            disabled={busy}
            title={busy ? 'Creating secure access…' : 'Generate student QR code'}
            onPress={() => void create()}
          />
        </>
      ) : (
        <View style={s.parentSharePanel}>
          <Image
            source={{ uri: qrImageUrl(share.url) }}
            accessibilityLabel={`QR code for ${studentName}'s learning dashboard`}
            resizeMode="contain"
            style={[s.parentShareQr, { aspectRatio: 1 }]}
          />
          <Text style={s.uploadRowTitle}>{studentName}</Text>
          <Text style={s.uploadRowCaption}>
            Expires {new Date(share.expiresAt).toLocaleDateString()}
          </Text>
          {/* `selectable` is the copy path that works everywhere, and the only
              one on a device without expo-clipboard. */}
          <Text selectable style={[s.input, s.parentShareInput]}>
            {share.url}
          </Text>
          {status ? (
            <Text role="status" style={s.uploadRowCaption}>
              {status}
            </Text>
          ) : null}
          <ButtonRow>
            <AppButton
              title="Email"
              onPress={() =>
                void openExternal(
                  `mailto:?subject=${encodeURIComponent(
                    `${studentName} learning dashboard`,
                  )}&body=${encodeURIComponent(
                    `Open the secure student dashboard: ${share.url}`,
                  )}`,
                  'No mail app is available on this device.',
                )
              }
            />
            <AppButton
              title="WhatsApp"
              onPress={() =>
                void openExternal(
                  `https://wa.me/?text=${encodeURIComponent(
                    `${studentName} learning dashboard: ${share.url}`,
                  )}`,
                  'WhatsApp could not be opened on this device.',
                )
              }
            />
            <AppButton title="Share link" onPress={() => void shareLink()} />
            <AppButton
              title="Open QR image"
              onPress={() =>
                void openExternal(
                  qrImageUrl(share.url),
                  'The QR image could not be opened on this device.',
                )
              }
            />
          </ButtonRow>
          <AppButton variant="primary" full title="Done" onPress={done} />
        </View>
      )}
    </>
  );
}
