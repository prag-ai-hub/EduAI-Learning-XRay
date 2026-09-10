/**
 * "Create or generate assessment" - everything the dialog does once the teacher
 * presses the button.
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx:945-996 (`CreateAssessment`).
 * The form itself stays in the dialog; this hook owns the pipeline, which is the
 * part with the branch, the two validations, the three PDF renders and the file
 * fan-out.
 *
 * The one shape change from the web: `File` does not exist in React Native, so
 * a picked document arrives as `PickedDocument` - name, MIME type, size and a
 * `FileSource` (the currency `@/shared/files` already speaks). The web file
 * picker hands over the browser `File` itself, which *is* a Blob and therefore
 * already a `FileSource`, so nothing is copied on that platform.
 */

import { useCallback, useState } from 'react';

import { authFetch } from '@/features/auth/api/authApi';
import { createBrandedPdfBlob } from '@/features/documents/lib/pdf';
import { textToDocumentHtml } from '@/features/documents/lib/html';
import { supportsDocumentUpload } from '@/features/workspace/lib/demo-state';
import { logApiTiming } from '@/features/workspace/lib/analytics';
import { base64FromBytes, blobToBase64 } from '@/shared/api/net';
import { saveFile, type FileSource } from '@/shared/files';
import type { Assessment, DemoState, DocumentRole, UploadFile } from '@/shared/types/workspace';
import type { SetWorkspace } from '@/shared/types/workspace-props';

/** Mirrors the ceiling `@/shared/files` and /api/files/[id] both enforce. */
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * A document the teacher chose, in the platform-neutral shape `file-picker.tsx`
 * produces. Structural on purpose: nothing here imports the picker, so the
 * dialogs in a later wave can supply the same fields from anywhere.
 */
export type PickedDocument = {
  name: string;
  /** '' is tolerated and treated the way the web app treated a typeless File. */
  type: string;
  size: number;
  source: FileSource;
};

export type AssessmentSourceMode = 'upload' | 'generate';

/** Exactly the fields the dialog's form collects. */
export type CreateAssessmentInput = {
  title: string;
  type: string;
  className: string;
  section: string;
  subject: string;
  maxMarks: number;
  date: string;
  sourceMode: AssessmentSourceMode;
  /** `sourceMode === 'upload'` - required; the other two are optional. */
  questionPaper?: PickedDocument;
  markingScheme?: PickedDocument;
  modelAnswer?: PickedDocument;
  /** `sourceMode === 'generate'` - optional structure for the generator. */
  blueprint?: PickedDocument;
};

export type UseCreateAssessment = {
  /** Runs the pipeline. Never throws: failures land in `error`. */
  submit: (input: CreateAssessmentInput) => Promise<void>;
  saving: boolean;
  error: string;
  setError: (message: string) => void;
};

type Reference = { document: PickedDocument; role: DocumentRole };

/**
 * Base64 for the blueprint payload /api/generate-assessment expects.
 *
 * Only the two in-memory arms are supported. A picked file that is nothing but
 * a device URI would need a read this module has no business doing - the picker
 * resolves bytes before it hands anything over, so this is a guard, not a gap.
 */
async function sourceBase64(source: FileSource): Promise<string> {
  const bytes: unknown = (source as { bytes?: unknown }).bytes;
  // A DOM Blob declares a `bytes()` METHOD, so the property exists on both arms
  // of the union; the instance check is what actually separates them.
  if (bytes instanceof Uint8Array) return base64FromBytes(bytes);
  if ('uri' in source)
    throw new Error('This document could not be read. Choose it again and retry.');
  // Only the Blob arm is left, but the union's `{ bytes }` arm cannot be
  // eliminated statically - `bytes` is `unknown` to the compiler above.
  return blobToBase64(source as Blob);
}

/**
 * A file id. `crypto.randomUUID` is present in a browser and in Expo's newer
 * runtimes but is not guaranteed on Hermes, and an id that comes back
 * `undefined` would collide silently across every upload in a session.
 */
function newFileId(): string {
  const uuid = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID;
  const value = uuid ? uuid.call(globalThis.crypto) : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `f${value}`;
}

export function useCreateAssessment({
  setState,
  done,
}: {
  setState: SetWorkspace;
  /** Called with the new assessment's id once it is in the workspace. */
  done: (id: string) => void;
}): UseCreateAssessment {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = useCallback(
    async (input: CreateAssessmentInput) => {
      setError('');
      const { title, className, subject, maxMarks, sourceMode } = input;
      const references: Reference[] = [];
      setSaving(true);
      try {
        let questionCount = 0;
        let answerKey = '';
        let rubric = '';

        if (sourceMode === 'upload') {
          const { questionPaper, markingScheme, modelAnswer } = input;
          if (!questionPaper || !questionPaper.size)
            throw new Error('A question paper is required before the assessment can be created.');
          references.push({ document: questionPaper, role: 'Question paper' });
          if (markingScheme && markingScheme.size)
            references.push({ document: markingScheme, role: 'Marking scheme' });
          if (modelAnswer && modelAnswer.size)
            references.push({ document: modelAnswer, role: 'Model answer' });
        } else {
          const { blueprint } = input;
          if (blueprint && blueprint.size && !supportsDocumentUpload(blueprint))
            throw new Error(`${blueprint.name}: unsupported blueprint format.`);
          const blueprintPayload =
            blueprint && blueprint.size
              ? {
                  name: blueprint.name,
                  mimeType: blueprint.type || 'application/octet-stream',
                  base64: await sourceBase64(blueprint.source),
                }
              : undefined;

          const response = await authFetch('/api/generate-assessment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title,
              type: input.type,
              className,
              subject,
              maxMarks,
              blueprint: blueprintPayload,
            }),
          });
          const payload = await response.json();
          logApiTiming(setState, payload?.timing);
          if (!response.ok) throw new Error(payload?.error || 'Assessment generation failed.');

          questionCount = Math.max(1, Number(payload.questionCount) || 1);
          answerKey = String(payload.modelAnswerText || '');
          rubric = String(payload.markingSchemeText || '');

          const safeTitle = title.replace(/[^a-z0-9-]+/gi, '-');
          const documentMeta = `Class ${className} · ${subject} · ${title}`;
          const [questionPaperPdf, markingSchemePdf, modelAnswerPdf] = await Promise.all([
            createBrandedPdfBlob(
              `${title} · Question Paper`,
              documentMeta,
              textToDocumentHtml(String(payload.questionPaperText)),
            ),
            createBrandedPdfBlob(
              `${title} · Marking Scheme`,
              documentMeta,
              textToDocumentHtml(String(payload.markingSchemeText)),
            ),
            createBrandedPdfBlob(
              `${title} · Model Answer`,
              documentMeta,
              textToDocumentHtml(String(payload.modelAnswerText)),
            ),
          ]);

          // The web wrapped each blob in `new File(...)` to give it a name. A
          // FileSource has no name, so the name travels beside it instead;
          // `size` comes from the blob, which is what File reported too.
          references.push(
            generatedReference(questionPaperPdf, `${safeTitle}-Question-Paper.pdf`, 'Question paper'),
            generatedReference(markingSchemePdf, `${safeTitle}-Marking-Scheme.pdf`, 'Marking scheme'),
            generatedReference(modelAnswerPdf, `${safeTitle}-Model-Answer.pdf`, 'Model answer'),
          );
          if (blueprint && blueprint.size)
            references.push({ document: blueprint, role: 'Supporting reference' });
        }

        if (references.some((item) => item.document.size > MAX_BYTES))
          throw new Error('Each document must be 10 MB or smaller.');
        if (references.some((item) => !supportsDocumentUpload(item.document)))
          throw new Error(
            'Use PDF, Word, Markdown, text, spreadsheet or supported image files.',
          );

        const files: UploadFile[] = references.map(({ document, role }) => ({
          id: newFileId(),
          name: document.name,
          type: document.type || 'application/pdf',
          size: document.size,
          progress: 100,
          status: 'OCR ready',
          documentRole: role,
        }));

        await Promise.all(
          files.map((item, index) => saveFile(item.id, references[index].document.source)),
        );

        const id = `a${Date.now()}`;
        const assessment: Assessment = {
          id,
          title,
          type: input.type,
          grade: className,
          section: input.section,
          subject,
          maxMarks,
          date: input.date,
          stage: 'draft',
          files,
          questions: questionCount,
          reviewed: 0,
          totalReviews: 0,
          quality: 0,
          published: false,
          version: 1,
          answerKey,
          rubric,
        };

        setState((s: DemoState) => ({
          ...s,
          assessments: [assessment, ...s.assessments],
          events: [
            `${
              sourceMode === 'generate'
                ? 'Assessment generated'
                : 'Assessment created with uploaded reference documents'
            } · ${assessment.title}`,
            ...s.events,
          ],
        }));
        done(id);
      } catch (cause) {
        // `saving` is deliberately left true on success: the web app never
        // cleared it either, because the dialog unmounts in `done`.
        setError(cause instanceof Error ? cause.message : 'Assessment could not be created.');
        setSaving(false);
      }
    },
    [setState, done],
  );

  return { submit, saving, error, setError };
}

/** A rendered PDF, as a reference document. */
function generatedReference(source: FileSource, name: string, role: DocumentRole): Reference {
  const bytes: unknown = (source as { bytes?: unknown }).bytes;
  const size =
    bytes instanceof Uint8Array ? bytes.byteLength : ((source as Blob).size ?? 0);
  return { document: { name, type: 'application/pdf', size, source }, role };
}
