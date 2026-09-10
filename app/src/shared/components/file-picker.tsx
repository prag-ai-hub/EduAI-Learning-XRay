/**
 * Choosing a file, on three platforms that disagree about what that means.
 *
 * Ported from the `<input type="file">` call sites in
 * frontend/app/ui/FunctionalEduAIApp.tsx - the dropzone in `UploadDialogV2`
 * (1979-1987), the four labelled inputs in `CreateAssessment` (996) and the
 * roster import at 1633 - plus the per-file `<select>` of document roles.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTE - read before changing anything here
 * ---------------------------------------------------------------------------
 * `<input type="file">` has no React Native equivalent, and neither
 * `expo-document-picker` nor `expo-image-picker` is in app/package.json. This
 * file does NOT add them: adding a native module is a build-level change with
 * its own config plugin and prebuild, and the brief for this wave is to report
 * that need rather than take it.
 *
 * So:
 *  * **Web** works fully. The input is created imperatively rather than written
 *    as JSX, because react-native-web does not render a raw `<input>` - and it
 *    keeps the whole DOM dependency inside one guarded function.
 *  * **iOS / Android** report `available: false` and `unavailableReason`. A
 *    caller shows that instead of a dead button. Nothing throws, and no screen
 *    that merely renders a picker breaks on a device.
 *
 * When expo-document-picker lands, `pickOnWeb` gains a sibling and `available`
 * becomes true; nothing above this module changes.
 *
 * `accept` and `validate` are props rather than imports. `DOCUMENT_ACCEPT` and
 * `supportsDocumentUpload` live in `@/features/workspace/lib/demo-state`, and
 * `shared/` may never import `features/` - so the feature passes its own rules
 * in, which also lets the roster importer accept a narrower list than the
 * evidence dropzone does.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppButton } from '@/shared/components/buttons';
import { Select } from '@/shared/components/form';
import type { FileSource } from '@/shared/files';
import type { DocumentRole } from '@/shared/types/workspace';
import { useAppStyles } from '@/shared/theme/styles';

/**
 * A file the user chose, in the shape the rest of the app consumes.
 *
 * `source` is a `FileSource` - on the web that is the browser `File` itself,
 * which is already a Blob, so nothing is copied to produce one.
 */
export type PickedFile = {
  name: string;
  /** '' when the platform could not tell; callers fall back the way the web did. */
  type: string;
  size: number;
  source: FileSource;
};

/** Every value `DocumentRole` can take, in the order the web `<select>` listed them. */
export const DOCUMENT_ROLES: readonly DocumentRole[] = [
  'Question paper',
  'Marking scheme',
  'Model answer',
  'Ungraded answer sheet',
  'Teacher-graded answer sheet',
  'Supporting reference',
];

export type UseFilePicker = {
  /** Opens the chooser. Resolves to [] when the user cancels or on an unsupported platform. */
  pick: (options?: { multiple?: boolean; accept?: string }) => Promise<PickedFile[]>;
  /** Always true now that both platforms have a chooser. Kept so call sites
   *  that already branch on it do not have to change if a platform loses it. */
  available: boolean;
  /** Why not, in words a teacher can read. Empty when `available`. */
  unavailableReason: string;
};

export function useFilePicker(): UseFilePicker {
  const pick = useCallback(
    async (options?: { multiple?: boolean; accept?: string }): Promise<PickedFile[]> => {
      const multiple = options?.multiple ?? false;
      return Platform.OS === 'web'
        ? pickOnWeb(multiple, options?.accept)
        : pickOnNative(multiple, options?.accept);
    },
    [],
  );

  return { pick, available: true, unavailableReason: '' };
}

/**
 * The native chooser.
 *
 * `source` is `{ uri }` rather than bytes: `FileSource` already accepts a URI,
 * and copying a 15 MB answer sheet into memory to hand it straight back to
 * `@/shared/files` would be work for nothing. `copyToCacheDirectory` is what
 * makes that URI outlive the picker - a content:// URI from the Android share
 * sheet is revoked as soon as the dialog closes.
 *
 * The web `accept` string is a mix of extensions and MIME types; iOS wants
 * UTIs and Android wants MIME types. Only the MIME entries translate, so a list
 * with none of them falls back to the wildcard and the filter becomes advisory
 * rather than enforced - the caller already validates by extension after the
 * pick, which is what the web app relied on too.
 */
async function pickOnNative(multiple: boolean, accept?: string): Promise<PickedFile[]> {
  const picker = await import('expo-document-picker');
  const mimeTypes = (accept ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.includes('/'));

  const result = await picker.getDocumentAsync({
    multiple,
    type: mimeTypes.length > 0 ? mimeTypes : '*/*',
    copyToCacheDirectory: true,
  });
  if (result.canceled) return [];

  return result.assets.map((asset) => ({
    name: asset.name,
    type: asset.mimeType ?? '',
    size: asset.size ?? 0,
    source: { uri: asset.uri, type: asset.mimeType ?? undefined },
  }));
}

/**
 * The browser chooser.
 *
 * The input is appended to the document rather than left detached because
 * Safari will not open a picker for a node that is not in the tree. `cancel`
 * is listened for alongside `change` so a dismissed dialog settles the promise
 * instead of leaving it pending for the life of the page - older browsers that
 * do not fire it simply leave the (harmless) listener attached to a removed
 * node until the next pick.
 */
function pickOnWeb(multiple: boolean, accept?: string): Promise<PickedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple;
    if (accept) input.accept = accept;
    input.style.cssText = 'position:fixed;left:-100000px;top:0;width:1px;height:1px;opacity:0';

    let settled = false;
    const finish = (files: PickedFile[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };

    input.addEventListener('change', () => finish(fromFileList(input.files)));
    input.addEventListener('cancel', () => finish([]));
    document.body.appendChild(input);
    input.click();
  });
}

/** A DOM `FileList`, as `PickedFile[]`. Web only - callers are already guarded. */
function fromFileList(list: FileList | null): PickedFile[] {
  if (!list) return [];
  return Array.from(list).map((file) => ({
    name: file.name,
    type: file.type || '',
    size: file.size,
    source: file,
  }));
}

/* ------------------------------------------------------------------------- *
 * FilePickerButton
 * ------------------------------------------------------------------------- */

export type FilePickerButtonProps = {
  /**
   * The label the web wrapped around the input:
   * `<Field label="Question paper · required"><input type="file"/></Field>`.
   * `form.tsx`'s `Field` renders its own TextInput and takes no children, so
   * the labelled shape lives here instead.
   */
  label?: string;
  /** Button text when nothing is chosen. */
  title?: string;
  accept?: string;
  multiple?: boolean;
  onPicked: (files: PickedFile[]) => void;
  /** Returns a message to reject the choice, or null to accept it. */
  validate?: (file: PickedFile) => string | null;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * One labelled "choose a file" control, with the chosen name underneath.
 *
 * Rejected files are reported and dropped, which is what the upload dialog did
 * per file rather than failing the whole selection.
 */
export function FilePickerButton({
  label,
  title = 'Browse / Choose File',
  accept,
  multiple = false,
  onPicked,
  validate,
  disabled,
  style,
}: FilePickerButtonProps) {
  const s = useAppStyles();
  const { pick, available, unavailableReason } = useFilePicker();
  const [chosen, setChosen] = useState<PickedFile[]>([]);
  const [error, setError] = useState('');

  const choose = useCallback(async () => {
    setError('');
    const files = await pick({ multiple, accept });
    if (!files.length) return;
    const rejected: string[] = [];
    const accepted = files.filter((file) => {
      const message = validate?.(file);
      if (message) rejected.push(message);
      return !message;
    });
    if (rejected.length) setError(rejected[0]);
    setChosen(accepted);
    if (accepted.length) onPicked(accepted);
  }, [pick, multiple, accept, validate, onPicked]);

  return (
    <View style={[s.label, style]}>
      {label ? <Text style={s.labelText}>{label}</Text> : null}
      <AppButton
        title={title}
        onPress={() => void choose()}
        disabled={disabled || !available}
        accessibilityLabel={label ? `${label}. ${title}` : title}
      />
      {chosen.length ? (
        <Text style={s.uploadRowCaption}>
          {chosen.length === 1 ? chosen[0].name : `${chosen.length} files selected`}
        </Text>
      ) : null}
      {error ? (
        <View style={s.formError}>
          <Text style={s.formErrorText}>{error}</Text>
        </View>
      ) : null}
      {!available ? <Text style={s.uploadRowCaption}>{unavailableReason}</Text> : null}
    </View>
  );
}

/* ------------------------------------------------------------------------- *
 * DropZone
 * ------------------------------------------------------------------------- */

export type DropZoneProps = {
  title?: string;
  caption?: string;
  accept?: string;
  multiple?: boolean;
  onPicked: (files: PickedFile[]) => void;
  /** `.dropzone.uploaded` - the green border once something is in. */
  uploaded?: boolean;
  disabled?: boolean;
};

/**
 * `.dropzone` - the big tap target, with real drag-and-drop on the web.
 *
 * Dragging has no meaning on a phone, so the drop listeners are attached only
 * under `Platform.OS === 'web'`, through the DOM node react-native-web puts
 * behind the `View`. Pressing works everywhere the picker does.
 */
export function DropZone({
  title = 'Drop scanned handwriting or digital files',
  caption = 'PDF, Word, Markdown, text, spreadsheet or image · multiple files · 10 MB each',
  accept,
  multiple = true,
  onPicked,
  uploaded,
  disabled,
}: DropZoneProps) {
  const s = useAppStyles();
  const { pick, available, unavailableReason } = useFilePicker();
  const host = useRef<View | null>(null);

  const dropped = useRef(onPicked);
  useEffect(() => {
    dropped.current = onPicked;
  });

  useEffect(() => {
    if (Platform.OS !== 'web' || disabled) return;
    // react-native-web forwards the ref to the underlying DOM element; on any
    // other platform this ref is a native view handle with no addEventListener,
    // which is why the whole block sits behind the platform check.
    const node = host.current as unknown as HTMLElement | null;
    if (!node?.addEventListener) return;

    const over = (event: Event) => event.preventDefault();
    const drop = (event: Event) => {
      event.preventDefault();
      const transfer = (event as DragEvent).dataTransfer;
      const files = fromFileList(transfer?.files ?? null);
      if (files.length) dropped.current(files);
    };
    node.addEventListener('dragover', over);
    node.addEventListener('drop', drop);
    return () => {
      node.removeEventListener('dragover', over);
      node.removeEventListener('drop', drop);
    };
  }, [disabled]);

  const choose = useCallback(async () => {
    const files = await pick({ multiple, accept });
    if (files.length) onPicked(files);
  }, [pick, multiple, accept, onPicked]);

  return (
    <Pressable
      ref={host}
      role="button"
      accessibilityLabel={title}
      accessibilityHint={caption}
      accessibilityState={{ disabled: Boolean(disabled || !available) }}
      disabled={disabled || !available}
      onPress={() => void choose()}
      style={[s.dropzone, uploaded && s.dropzoneUploaded]}>
      <Text style={[s.dropzoneIcon, uploaded && s.dropzoneIconUploaded]}>↑</Text>
      <Text style={s.dropzoneTitle}>{title}</Text>
      <Text style={s.dropzoneCaption}>{available ? caption : unavailableReason}</Text>
      <AppButton
        title="Browse / Choose File"
        onPress={() => void choose()}
        disabled={disabled || !available}
      />
    </Pressable>
  );
}

/* ------------------------------------------------------------------------- *
 * DocumentRolePicker
 * ------------------------------------------------------------------------- */

/**
 * The per-file `<select>` that classifies an uploaded document.
 *
 * The role decides what grading, learning-gap analysis, study guides and
 * worksheets are allowed to do with the file, which is why it is a control on
 * the upload row rather than a guess made once at import.
 *
 * Deliberately unnamed to `Form`: it is edited per row against a list the
 * dialog holds in state, so it is always controlled and never submitted.
 */
export function DocumentRolePicker({
  value,
  onChange,
  fileName,
  style,
}: {
  value: DocumentRole;
  onChange: (role: DocumentRole) => void;
  /** Used only for the accessible name, as `aria-label` was on the web. */
  fileName?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const s = useAppStyles();
  const options = useMemo(() => [...DOCUMENT_ROLES], []);
  return (
    <Select
      label={fileName ? `Document role for ${fileName}` : 'Document role'}
      options={options}
      value={value}
      onValueChange={(next) => onChange(next as DocumentRole)}
      style={[s.evidenceUploadListSelect, style]}
    />
  );
}
