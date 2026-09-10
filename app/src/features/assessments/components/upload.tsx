/**
 * Upload and classify the evidence for one assessment.
 *
 * Ported from `UploadDialogV2` (frontend/app/ui/FunctionalEduAIApp.tsx:1979).
 *
 * The document role on each row is the point of the dialog, not decoration: it
 * decides what grading, learning-gap analysis, study guides and worksheets are
 * allowed to do with the file. A new upload is defaulted to "Ungraded answer
 * sheet" (as the source did), while a file already on the assessment that
 * carries no role falls back to `inferDocumentRole` for display, so the picker
 * always shows the role that the rest of the app would act on.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTES
 * ---------------------------------------------------------------------------
 *  * **Choosing files.** The `<input type="file">` and its drag-and-drop
 *    handlers are `DropZone` from `@/shared/components/file-picker`, which
 *    works on all three platforms - expo-document-picker landed after wave 2 -
 *    and keeps the drag listeners behind its own web guard.
 *  * **Previews.** The web made a `blob:` URL and never revoked it. On native a
 *    picked document already *is* a `file://` URI that `<Image>` renders, so
 *    the preview is read straight off the picked source, and the object URLs
 *    the web branch creates are revoked when the dialog closes.
 *  * **Timers.** `window.setInterval`/`window.setTimeout` are the globals here.
 *    Both handles are held so the dialog can cancel them if it is closed
 *    mid-upload; on the web the component was simply thrown away with the tab.
 *
 * The upload bar itself is a simulation - it was in the source too. The real
 * work is `saveFile`, which starts the moment a file is chosen and is awaited
 * before the bar is allowed to run, so "100%" never appears over a file that is
 * still in flight.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Platform, Pressable, Text, View } from 'react-native';

import { DOCUMENT_ACCEPT, supportsDocumentUpload } from '@/features/workspace/lib/demo-state';
import { inferDocumentRole } from '@/features/workspace/lib/documents';
import { AppButton, ButtonRow } from '@/shared/components/buttons';
import { DocumentRolePicker, DropZone, type PickedFile } from '@/shared/components/file-picker';
import { DialogHead, Progress } from '@/shared/components/primitives';
import { saveFile, type FileSource } from '@/shared/files';
import { useAppStyles } from '@/shared/theme/styles';
import type { DocumentRole, UploadFile, W } from '@/shared/types/workspace';

/** Mirrors the ceiling `@/shared/files` and /api/files/[id] both enforce. */
const MAX_BYTES = 10 * 1024 * 1024;

/** How fast the simulated bar fills: +10% every 180ms, as the source had it. */
const TICK_MS = 180;
const STEP = 10;
/** The pause between "100%" and the dialog closing, so the bar is seen to finish. */
const SETTLE_MS = 350;

/**
 * A file id. `crypto.randomUUID` exists in a browser and in Expo's newer
 * runtimes but is not guaranteed on Hermes, and an id that came back
 * `undefined` would collide silently across every upload in a session.
 */
function newFileId(): string {
  const uuid = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID;
  const value = uuid
    ? uuid.call(globalThis.crypto)
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `f${value}`;
}

/**
 * A renderable URI for an image that has just been picked, or undefined.
 *
 * HEIC is excluded because no browser and no `<Image>` decodes it; the source
 * made the same exclusion. The native arm needs no object URL at all - the
 * picker's `copyToCacheDirectory` URI outlives the dialog - which is why only
 * the web arm has anything to revoke.
 */
function previewFor(file: PickedFile): string | undefined {
  if (!file.type.startsWith('image/') || file.type.includes('heic')) return undefined;
  const source: FileSource = file.source;
  if ('uri' in source) return source.uri;
  if (Platform.OS !== 'web') return undefined;
  // Only the Blob arm can be left on web, but `'bytes' in source` cannot say so
  // - a DOM Blob declares a `bytes()` METHOD, so the key is on both arms of the
  // union. The instance check is what actually separates them.
  if (!(source instanceof Blob)) return undefined;
  const create = (globalThis as { URL?: { createObjectURL?: (blob: Blob) => string } }).URL
    ?.createObjectURL;
  return create ? create(source) : undefined;
}

function releasePreview(uri: string): void {
  if (Platform.OS !== 'web') return;
  const revoke = (globalThis as { URL?: { revokeObjectURL?: (uri: string) => void } }).URL
    ?.revokeObjectURL;
  revoke?.(uri);
}

function extensionOf(name: string): string {
  return name.split('.').pop()?.toUpperCase() || 'FILE';
}

export function UploadDialogV2({ assessment, update, done }: W<'assessment' | 'update' | 'done'>) {
  const s = useAppStyles();
  const [files, setFiles] = useState<UploadFile[]>(assessment.files || []);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [paused, setPaused] = useState(false);

  const pauseRef = useRef(false);
  const pendingUploads = useRef(new Map<string, Promise<void>>());
  const objectUrls = useRef<string[]>([]);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The finishing timeout has to read the roles as they stand when it fires,
  // not as they stood when "Save evidence" was pressed - otherwise a role
  // changed while the bar was running is silently discarded.
  const latest = useRef(files);
  useEffect(() => {
    latest.current = files;
  });

  useEffect(
    () => () => {
      if (tick.current) clearInterval(tick.current);
      if (settle.current) clearTimeout(settle.current);
      objectUrls.current.forEach(releasePreview);
      objectUrls.current = [];
    },
    [],
  );

  const add = useCallback((picked: PickedFile[]) => {
    setError('');
    const next: UploadFile[] = [];

    picked.forEach((file) => {
      if (!supportsDocumentUpload(file)) {
        setError(
          `${file.name}: unsupported format. Use PDF, Word, Markdown, text, spreadsheet or an image.`,
        );
        return;
      }
      if (file.size > MAX_BYTES) {
        setError(`${file.name}: exceeds the 10 MB limit.`);
        return;
      }

      const id = newFileId();
      const preview = previewFor(file);
      if (preview && Platform.OS === 'web') objectUrls.current.push(preview);

      next.push({
        id,
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        progress: 0,
        status: 'Saving securely',
        documentRole: 'Ungraded answer sheet',
        preview,
      });

      const pending = saveFile(id, file.source)
        .then(() => {
          setFiles((items) =>
            items.map((item) => (item.id === id ? { ...item, status: 'Ready' } : item)),
          );
        })
        .catch((cause: unknown) => {
          setFiles((items) =>
            items.map((item) =>
              item.id === id ? { ...item, status: 'Failed · try again' } : item,
            ),
          );
          throw cause;
        })
        .finally(() => {
          pendingUploads.current.delete(id);
        });

      pendingUploads.current.set(id, pending);
      // The stored promise is inspected by `start`; this second handle keeps a
      // failure that nobody ever presses "Save" on from surfacing as an
      // unhandled rejection, which on native is a red screen in development.
      void pending.catch(() => undefined);
    });

    setFiles((current) => [...current, ...next]);
  }, []);

  const start = async () => {
    if (!files.length) {
      setError('Choose at least one supported file.');
      return;
    }
    setUploading(true);
    setError('');

    const saves = await Promise.allSettled(Array.from(pendingUploads.current.values()));
    if (saves.some((result) => result.status === 'rejected')) {
      setUploading(false);
      setError(
        'One or more files could not be saved. Your earlier files are still present; remove or retry only the failed files.',
      );
      return;
    }

    let percent = 0;
    tick.current = setInterval(() => {
      if (pauseRef.current) return;
      percent += STEP;
      const value = Math.min(100, percent);
      setFiles((items) =>
        items.map((item) => ({
          ...item,
          progress: value,
          status: value >= 100 ? 'Uploaded · quality checked' : 'Uploading',
        })),
      );
      if (percent < 100) return;

      if (tick.current) clearInterval(tick.current);
      tick.current = null;
      setUploading(false);
      settle.current = setTimeout(() => {
        settle.current = null;
        const finished = latest.current;
        // The source's one piece of content inference: a set of economics
        // papers renames the assessment and its subject. Kept verbatim.
        const names = finished.map((item) => item.name).join(' ').toLowerCase();
        const economics = /econom|micro|macro|demand|supply|gdp/.test(names);
        update(assessment.id, {
          files: finished.map((item) => ({
            ...item,
            progress: 100,
            status: 'OCR complete',
            preview: undefined,
          })),
          stage: 'uploaded',
          title: economics ? 'Economics question paper & answer sheets' : assessment.title,
          subject: economics ? 'Economics' : assessment.subject,
          totalReviews: Math.max(assessment.totalReviews, finished.length * 4),
        });
        done();
      }, SETTLE_MS);
    }, TICK_MS);
  };

  const pause = () => {
    pauseRef.current = !pauseRef.current;
    setPaused(pauseRef.current);
    setFiles((items) =>
      items.map((item) => ({ ...item, status: pauseRef.current ? 'Paused' : 'Uploading' })),
    );
  };

  const setRole = (id: string, role: DocumentRole) =>
    setFiles((items) =>
      items.map((item) => (item.id === id ? { ...item, documentRole: role } : item)),
    );

  const remove = (id: string) => {
    // Released here rather than inside the state updater: an updater may be
    // invoked twice, and a side effect in one runs twice with it.
    const going = files.find((item) => item.id === id);
    if (going?.preview) {
      releasePreview(going.preview);
      objectUrls.current = objectUrls.current.filter((uri) => uri !== going.preview);
    }
    setFiles((items) => items.filter((item) => item.id !== id));
  };

  return (
    <>
      <DialogHead eyebrow={assessment.title} title="Upload and classify evidence" />
      <Text style={s.modalCopy}>
        The document roles below determine how grading, learning-gap analysis, study guides and
        worksheets use each file.
      </Text>

      {/* No `uploaded` prop: `.dropzone.uploaded` is another screen's green
          border, and this dialog's dropzone never carried it. */}
      <DropZone accept={DOCUMENT_ACCEPT} multiple onPicked={add} />

      {error ? (
        <View role="alert" style={s.formError}>
          <Text style={s.formErrorText}>{error}</Text>
        </View>
      ) : null}

      <View style={[s.uploadList, s.evidenceUploadList]}>
        {files.map((file) => (
          <View key={file.id} style={s.uploadRow}>
            {file.preview ? (
              <Image
                source={{ uri: file.preview }}
                accessibilityLabel={`Preview ${file.name}`}
                resizeMode="cover"
                style={s.fileIcon}
              />
            ) : (
              <View style={s.fileIcon}>
                <Text style={s.fileIconText}>{extensionOf(file.name)}</Text>
              </View>
            )}
            <View style={s.uploadRowBody}>
              <Text style={s.uploadRowTitle} numberOfLines={1}>
                {file.name}
              </Text>
              <Text style={s.uploadRowCaption} numberOfLines={1}>
                {(file.size / 1024 / 1024).toFixed(2)} MB · {file.status}
              </Text>
              <DocumentRolePicker
                fileName={file.name}
                value={file.documentRole || inferDocumentRole(file.name)}
                onChange={(role) => setRole(file.id, role)}
              />
              <Progress value={file.progress} />
            </View>
            <Pressable
              role="button"
              accessibilityLabel={`Remove ${file.name}`}
              accessibilityState={{ disabled: uploading }}
              disabled={uploading}
              onPress={() => remove(file.id)}>
              <Text style={s.uploadRowRemove}>×</Text>
            </Pressable>
          </View>
        ))}
      </View>

      <ButtonRow>
        {uploading ? <AppButton title={paused ? 'Resume' : 'Pause'} onPress={pause} /> : null}
        <AppButton
          title="Retry failed"
          disabled={uploading}
          onPress={() =>
            setFiles((items) =>
              items.map((item) =>
                item.status.includes('Failed') ? { ...item, status: 'Ready', progress: 0 } : item,
              ),
            )
          }
        />
        <AppButton
          title="Save evidence & start OCR"
          variant="primary"
          disabled={uploading}
          onPress={() => void start()}
        />
      </ButtonRow>
    </>
  );
}
