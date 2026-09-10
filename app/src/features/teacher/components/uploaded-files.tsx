/**
 * The uploaded evidence card - what a file IS, and what may be run on it.
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx `UploadedFiles` (~1935).
 *
 * The classification decides the row's actions, which is the whole point of the
 * card: only an answer sheet offers analysis, a sheet the teacher already
 * marked is diagnosed rather than re-graded (`analysisDialogFor`), and the
 * learning-gaps button refuses and redirects until there is a graded result to
 * report on.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTE - preview
 * ---------------------------------------------------------------------------
 * The web previewed by `URL.createObjectURL(blob)` into `window.open(url)`, and
 * never revoked that URL. There is no second tab on a phone, so Preview opens
 * the file in place: `useFileUri` resolves a renderable URI (`blob:` on web,
 * `file://` on native) and releases it when the selection changes or the card
 * unmounts. An image renders inline; anything else offers "Open", which is the
 * new tab on web and the system viewer on a device.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTE - download and conversion
 * ---------------------------------------------------------------------------
 * The conversion path is unchanged: a real PDF is verified and saved as-is; an
 * image is embedded as a data URI; text is laid out by `textToDocumentHtml`;
 * anything else is sent to /api/document-to-pdf-source for extraction first.
 * Only the plumbing moved - the bytes come from `@/shared/files` rather than
 * IndexedDB directly, and the base64 comes off the stored file rather than from
 * a hand-written FileReader, which has no counterpart on native.
 *
 * Rendering a PDF is web-only (`@/features/documents/lib/pdf` raises
 * `PdfUnavailableError` otherwise), so every download is wrapped and its
 * failure surfaces as a toast.
 */

import { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { openBrowserAsync } from 'expo-web-browser';

import { downloadDocument, savePdfBytes, verifiedPdfBytes } from '@/features/documents/lib/pdf';
import { htmlEscape, textToDocumentHtml } from '@/features/documents/lib/html';
import {
  analysisDialogFor,
  inferDocumentRole,
  isAnswerSheetFile,
} from '@/features/workspace/lib/documents';
import { authFetch } from '@/features/auth/api/authApi';
import { AppButton, ButtonRow, LinkButton } from '@/shared/components/buttons';
import { CardHead, CardSpan2 } from '@/shared/components/primitives';
import { EmptyState } from '@/shared/components/status';
import { deleteFile, readFile } from '@/shared/files';
import { useFileUri } from '@/shared/hooks/use-file-uri';
import { useAppStyles } from '@/shared/theme/styles';
import type { UploadFile, W } from '@/shared/types/workspace';

/** The extensions the web treated as plain text when the MIME type did not say so. */
const TEXTUAL = /\.(md|markdown|txt|rtf|html?|xml|json|ya?ml|csv|tsv)$/i;

const MISSING_FILE =
  'The original file is not available in secure storage. Upload it again to restore preview and download.';

function baseNameOf(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

export function UploadedFiles({
  assessment,
  update,
  notify,
  open,
}: W<'assessment' | 'update' | 'notify' | 'open'>) {
  const s = useAppStyles();
  const files: UploadFile[] = assessment.files || [];

  const [previewId, setPreviewId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const previewUri = useFileUri(previewId);
  const previewFile = files.find((file) => file.id === previewId);

  const preview = async (file: UploadFile) => {
    // Read first: a missing file has to warn rather than open an empty panel,
    // which is what the web's `if (!blob)` guard did before creating the URL.
    const stored = await readFile(file.id);
    if (!stored) {
      notify(MISSING_FILE, 'warning');
      return;
    }
    setPreviewId(file.id);
  };

  const download = async (file: UploadFile) => {
    setBusyId(file.id);
    try {
      const stored = await readFile(file.id);
      if (!stored) {
        notify(MISSING_FILE, 'warning');
        return;
      }

      if (stored.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
        let bytes;
        try {
          bytes = await verifiedPdfBytes({ bytes: await stored.bytes(), type: stored.type });
        } catch {
          notify(
            `${file.name} is labelled as PDF but its contents are not a valid PDF. Re-upload or convert the original file.`,
            'error',
          );
          return;
        }
        savePdfBytes(bytes, baseNameOf(file.name));
        return;
      }

      let body: string;
      if (stored.type.startsWith('image/')) {
        body = `<section class="topic"><img src="${await stored.dataUri()}" alt="${htmlEscape(
          file.name,
        )}" style="display:block;max-width:100%;height:auto;margin:0 auto"></section>`;
      } else if (stored.type.startsWith('text/') || TEXTUAL.test(file.name)) {
        body = textToDocumentHtml(await stored.text());
      } else {
        const response = await authFetch('/api/document-to-pdf-source', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: file.name,
            mimeType: stored.type,
            base64: await stored.base64(),
          }),
        });
        const payload = await response.json();
        if (!response.ok)
          throw new Error(payload?.error || 'This document could not be converted to PDF.');
        body = textToDocumentHtml(String(payload.text || ''));
      }

      await downloadDocument(
        baseNameOf(file.name),
        file.documentRole || inferDocumentRole(file.name),
        `${assessment.title} · Converted to a classroom-ready PDF`,
        body,
      );
    } catch (error) {
      notify(
        error instanceof Error ? error.message : 'This document could not be downloaded.',
        'error',
      );
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (file: UploadFile) => {
    try {
      await deleteFile(file.id);
    } catch {
      // The workspace row is what the teacher sees; a blob that outlives it is
      // a storage detail, not a reason to leave the file listed.
    }
    if (previewId === file.id) setPreviewId(null);
    update(assessment.id, { files: files.filter((f) => f.id !== file.id) });
    notify(`${file.name} removed`);
  };

  const openGaps = (file: UploadFile, graded: boolean) => {
    if (graded) {
      open(`student-gaps:${file.id}`);
      return;
    }
    notify('Grade this answer sheet first to unlock its learning gaps report', 'warning');
    open(`grade-file:${file.id}`);
  };

  return (
    <CardSpan2>
      <CardHead
        eyebrow={`${files.length} file${files.length === 1 ? '' : 's'} · ${assessment.title}`}
        title="Uploaded evidence">
        <AppButton
          variant="primary"
          icon="＋"
          title="Add files"
          onPress={() => open('upload')}
        />
      </CardHead>

      {files.length === 0 ? (
        <EmptyState
          title="No evidence uploaded yet"
          body="Add question papers, model answers, and graded or ungraded answer sheets.">
          <AppButton title="Browse files" onPress={() => open('upload')} />
        </EmptyState>
      ) : (
        <View style={s.uploadedFilesGrid}>
          {files.map((file) => {
            const answer = isAnswerSheetFile(file, files.length);
            const graded = Boolean(assessment.gradeResults?.[file.id]);
            return (
              <View key={file.id} style={s.uploadedFilesRow}>
                <View style={s.fileIcon}>
                  <Text style={s.fileIconText}>
                    {file.name.split('.').pop()?.toUpperCase()}
                  </Text>
                </View>
                <View style={s.uploadedFilesBody}>
                  <Text style={s.uploadedFilesTitle} numberOfLines={1}>
                    {file.name}
                  </Text>
                  <Text style={s.uploadedFilesCaption}>
                    {file.documentRole || inferDocumentRole(file.name)} ·{' '}
                    {(file.size / 1024 / 1024).toFixed(2)} MB · {file.status}
                    {graded ? ' · Analysed' : ''}
                  </Text>
                </View>
                <ButtonRow>
                  {answer ? (
                    <AppButton
                      variant="primary"
                      title={
                        graded
                          ? 'Reanalyse'
                          : file.documentRole === 'Teacher-graded answer sheet'
                            ? 'Analyse teacher marks'
                            : 'Analyse answer sheet'
                      }
                      onPress={() => open(`${analysisDialogFor(file)}:${file.id}`)}
                    />
                  ) : null}
                  {answer ? (
                    <AppButton
                      title={graded ? 'Learning gaps report' : 'Learning gaps (analyse first)'}
                      onPress={() => openGaps(file, graded)}
                    />
                  ) : null}
                  <AppButton title="Preview" onPress={() => void preview(file)} />
                  <AppButton
                    title={busyId === file.id ? 'Preparing…' : 'Download'}
                    disabled={busyId === file.id}
                    onPress={() => void download(file)}
                  />
                  <LinkButton danger title="Remove" onPress={() => void remove(file)} />
                </ButtonRow>
              </View>
            );
          })}
        </View>
      )}

      {previewFile && previewUri ? (
        <View
          style={
            previewFile.type.startsWith('image/') ? s.answerImageWrap : s.answerDocumentWrap
          }>
          <View style={s.cardHead}>
            <Text style={s.uploadedFilesTitle}>{previewFile.name}</Text>
            <LinkButton title="Close preview" onPress={() => setPreviewId(null)} />
          </View>
          {previewFile.type.startsWith('image/') ? (
            <Image
              source={{ uri: previewUri }}
              style={[s.answerImage, s.answerDocument]}
              resizeMode="contain"
              accessibilityLabel={previewFile.name}
            />
          ) : (
            <View style={[s.answerDocument, { alignItems: 'center', justifyContent: 'center' }]}>
              <Text style={s.uploadedFilesCaption}>
                {previewFile.documentRole || inferDocumentRole(previewFile.name)}
              </Text>
              <AppButton
                title="Open"
                onPress={() => void openBrowserAsync(previewUri)}
                accessibilityLabel={`Open ${previewFile.name}`}
              />
            </View>
          )}
        </View>
      ) : null}

      <Text style={s.storageNote}>
        Every report and generated resource stays linked to these classified source documents.
      </Text>
    </CardSpan2>
  );
}
