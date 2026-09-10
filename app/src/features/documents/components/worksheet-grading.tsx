/**
 * Grading completed answer sheets against a worksheet this app generated.
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx `WorksheetGradingDialog`
 * (~1459-1537).
 *
 * The important detail is the one the web app got wrong first and then fixed,
 * and the comment it left behind is kept because the failure was not obvious:
 * /api/grade works from teacher-validated OCR text, never from file bytes. This
 * dialog used to post `fileBase64`, which the route ignores, so every run came
 * back "Validate the answer-sheet OCR text before analysis." The worksheet
 * itself is the question paper, and it is sent as `text/plain` so it is parsed
 * locally rather than costing a Mistral OCR call per student.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTES
 * ---------------------------------------------------------------------------
 * * The `<div className="dropzone">` with a hidden `<input type="file">` is the
 *   shared `DropZone`, which keeps real drag-and-drop on web and is a tap
 *   target everywhere else.
 * * A picked file is bytes in the browser and a device URI on a phone. Only the
 *   file store can read a URI, so a native pick is written there under a stable
 *   id, read as base64, and removed again - the bytes are needed for one
 *   request and nothing keeps them afterwards.
 * * The progress ticker uses the plain `setInterval`; there is no `window`.
 */

import { useState } from 'react';
import { Text, View } from 'react-native';

import { authFetch } from '@/features/auth/api/authApi';
import { downloadAnswerKey, downloadText } from '@/features/documents/lib/downloads';
import { logApiTiming } from '@/features/workspace/lib/analytics';
import { DOCUMENT_ACCEPT, stableKey, supportsDocumentUpload } from '@/features/workspace/lib/demo-state';
import {
  worksheetMarkingSchemeText,
  worksheetMaxMarks,
  worksheetQuestionPaperText,
} from '@/features/workspace/lib/documents';
import { base64FromBytes, base64FromText, blobToBase64 } from '@/shared/api/net';
import { AppButton, ButtonRow, LinkButton } from '@/shared/components/buttons';
import { DropZone, type PickedFile } from '@/shared/components/file-picker';
import { DialogHead, Progress } from '@/shared/components/primitives';
import { deleteFile, saveFile } from '@/shared/files';
import { useAppStyles } from '@/shared/theme/styles';
import type { DemoState, Gap, W, Worksheet } from '@/shared/types/workspace';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

type SheetResult = { studentName: string; score: number; maxMarks: number; mastery: number };

/**
 * Base64 for one picked answer sheet.
 *
 * The web had a `File`, which is a Blob. A native pick is a `content://` or
 * `file://` URI, and `@/shared/files` is the only thing that can read one, so
 * the file goes into the store just long enough to be read back out.
 */
async function pickedBase64(file: PickedFile): Promise<string> {
  const source = file.source;
  const bytes: unknown = (source as { bytes?: unknown }).bytes;
  // A DOM Blob declares a `bytes()` METHOD, so the property exists on both arms
  // of the union; the instance check is what actually separates them.
  if (bytes instanceof Uint8Array) return base64FromBytes(bytes);
  if (!('uri' in source)) return blobToBase64(source as Blob);

  const id = `worksheet-answer-${stableKey(`${file.name}:${file.size}`)}`;
  const stored = await saveFile(id, source);
  try {
    return await stored.base64();
  } finally {
    await deleteFile(id);
  }
}

/** The student's name, guessed from a scan named "ravi-sharma_answer.pdf". */
function guessNameFromFile(name: string): string {
  const base = name
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b(answer|sheet|paper|qp|question|scan|img|copy|final|v\d+)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return base.length > 2
    ? base
        .split(' ')
        .filter(Boolean)
        .map((word) => word[0].toUpperCase() + word.slice(1))
        .join(' ')
    : 'Student';
}

function masteryLabel(mastery: number): string {
  return mastery >= 80 ? 'mastered' : mastery >= 60 ? 'developing' : 'further practice';
}

export function WorksheetGradingDialog({
  worksheet,
  setState,
  done,
}: W<'setState' | 'done'> & { worksheet?: Worksheet }) {
  const s = useAppStyles();
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [progress, setProgress] = useState(0);
  const [graded, setGraded] = useState(false);
  const [grading, setGrading] = useState(false);
  const [gradeError, setGradeError] = useState('');
  const [results, setResults] = useState<SheetResult[]>([]);

  // The worksheet is looked up with .find() at the call site and can miss.
  // The guard sits below every hook so the hook order never changes.
  if (!worksheet) {
    return (
      <>
        <DialogHead eyebrow="Worksheet" title="Worksheet unavailable" />
        <Text style={s.modalCopy}>
          This worksheet could not be found. Close this dialog and try again.
        </Text>
      </>
    );
  }

  const add = (picked: PickedFile[]) =>
    setFiles((current) => [...current, ...picked.filter(supportsDocumentUpload)]);

  const grade = async () => {
    if (!files.length) return;
    setGradeError('');
    setGrading(true);
    let p = 0;
    const timer = setInterval(() => {
      p = Math.min(90, p + 8);
      setProgress(p);
    }, 200);
    try {
      const paperText = worksheetQuestionPaperText(worksheet);
      const schemeText = worksheetMarkingSchemeText(worksheet.content);
      const gradedResults = await Promise.all(
        files.map(async (file): Promise<SheetResult> => {
          const fileBase64 = await pickedBase64(file);
          const studentName = guessNameFromFile(file.name);
          const ocrResponse = await authFetch('/api/ocr', {
            method: 'POST',
            headers: JSON_HEADERS,
            body: JSON.stringify({
              documents: [
                {
                  id: 'answerSheet',
                  name: file.name,
                  base64: fileBase64,
                  mimeType: file.type || 'application/pdf',
                },
                {
                  id: 'questionPaper',
                  name: `${worksheet.title || 'Worksheet'}.txt`,
                  base64: base64FromText(paperText),
                  mimeType: 'text/plain',
                },
              ],
            }),
          });
          const ocrPayload = await ocrResponse.json();
          logApiTiming(setState, ocrPayload?.timing);
          if (!ocrResponse.ok)
            throw new Error(ocrPayload?.error || `Text extraction failed for ${file.name}`);

          const res = await authFetch('/api/grade', {
            method: 'POST',
            headers: JSON_HEADERS,
            body: JSON.stringify({
              subject: worksheet.subject || worksheet.concept || 'General',
              className: worksheet.grade || '',
              studentName,
              fileName: file.name,
              documentRole: 'Ungraded answer sheet',
              maxMarks: worksheetMaxMarks(worksheet.content),
              rubric: worksheet.template || '',
              ocrText: ocrPayload.documents?.answerSheet?.text,
              questionPaperText: ocrPayload.documents?.questionPaper?.text,
              markingSchemeText: schemeText,
              operationKey: `worksheet:${worksheet.id || 'adhoc'}:${stableKey(
                file.name + String(file.size),
              )}`,
            }),
          });
          const payload = await res.json();
          logApiTiming(setState, payload?.timing);
          if (!res.ok) throw new Error(payload?.error || `Grading failed for ${file.name}`);
          const gaps: Gap[] = payload.gaps || [];
          const mastery = gaps.length
            ? Math.round(gaps.reduce((sum, gap) => sum + gap.mastery, 0) / gaps.length)
            : Math.round((payload.score / Math.max(1, payload.maxMarks)) * 100);
          return { studentName, score: payload.score, maxMarks: payload.maxMarks, mastery };
        }),
      );
      clearInterval(timer);
      setProgress(100);
      setResults(gradedResults);
      setGraded(true);
      setState((state: DemoState) => ({
        ...state,
        resources: state.resources.map((r) =>
          r.id === worksheet.id
            ? {
                ...r,
                answerSheets: (r.answerSheets || 0) + files.length,
                gradedSheets: (r.gradedSheets || 0) + files.length,
              }
            : r,
        ),
        events: [
          `${files.length} worksheet answer sheets graded with EduAI · ${worksheet.title}`,
          ...state.events,
        ],
      }));
    } catch (err) {
      clearInterval(timer);
      setGradeError(err instanceof Error ? err.message : 'Grading failed');
    } finally {
      setGrading(false);
    }
  };

  return (
    <>
      <DialogHead eyebrow={worksheet.title || 'Worksheet'} title="Grade answer worksheets" />

      <DropZone
        title="Drop completed answer sheets or choose files"
        caption="PDF, Word, Markdown, text or image · multiple students supported"
        accept={DOCUMENT_ACCEPT}
        multiple
        uploaded={files.length > 0}
        disabled={grading}
        onPicked={add}
      />

      <View style={s.uploadList}>
        {files.map((file, index) => (
          <View key={`${file.name}${index}`} style={s.uploadRow}>
            <View style={s.fileIcon}>
              <Text style={s.uploadRowCaption}>
                {file.name.split('.').pop()?.toUpperCase() || 'FILE'}
              </Text>
            </View>
            <View style={s.uploadRowBody}>
              <Text style={s.uploadRowTitle} numberOfLines={1}>
                {file.name}
              </Text>
              <Text style={s.uploadRowCaption}>Ready for extraction and grading</Text>
            </View>
            <LinkButton
              title="×"
              accessibilityLabel={`Remove ${file.name}`}
              textStyle={s.uploadRowRemove}
              onPress={() => setFiles((current) => current.filter((_, j) => j !== index))}
            />
          </View>
        ))}
      </View>

      {progress > 0 ? <Progress value={progress} /> : null}

      {gradeError ? (
        <View role="alert" style={s.formError}>
          <Text style={s.formErrorText}>{gradeError}</Text>
        </View>
      ) : null}

      {!graded ? (
        <AppButton
          variant="primary"
          full
          title={grading ? `Grading with EduAI… ${progress}%` : 'Grade uploaded worksheets'}
          disabled={!files.length || grading}
          onPress={() => void grade()}
        />
      ) : (
        <>
          <View style={s.gradingResults}>
            <Text style={s.labelText}>Grading complete · teacher check required</Text>
            {results.map((result, index) => (
              <Text key={`${result.studentName}${index}`} style={s.gradingResultRow}>
                {`${result.studentName} · ${result.score}/${result.maxMarks} · ${result.mastery}% · ${masteryLabel(result.mastery)}`}
              </Text>
            ))}
          </View>
          <ButtonRow>
            <AppButton
              title="Download graded results"
              onPress={() =>
                // Reported through the same slot the grading errors use. On a
                // device `downloadText` has no anchor to click and rejects, so
                // a bare `void` produced a dead button and, in development, an
                // unhandled-rejection red box. The results stay on screen.
                void downloadText(
                  `${worksheet.title}-Graded-Results.csv`,
                  `Student,Score,Mastery\n${results
                    .map((r) => `${r.studentName},${r.score}/${r.maxMarks},${r.mastery}%`)
                    .join('\n')}`,
                ).catch(() =>
                  setGradeError(
                    'Downloading the results file is only available on the web build for now.',
                  ),
                )
              }
            />
            <AppButton
              title="Check with answer key"
              onPress={() => void downloadAnswerKey(worksheet)}
            />
            <AppButton variant="primary" title="Teacher approves grades" onPress={done} />
          </ButtonRow>
        </>
      )}
    </>
  );
}
