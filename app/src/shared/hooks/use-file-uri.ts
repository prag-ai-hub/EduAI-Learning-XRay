import { useEffect, useState } from 'react';

import { openFile, type OpenFile } from '@/shared/files';

/**
 * A renderable URI for a stored file, released for you when the id changes or
 * the component unmounts.
 *
 * This is the replacement for the hand-rolled
 * `URL.createObjectURL` / `URL.revokeObjectURL` pairs in the Next.js app - the
 * evaluator source pane (FunctionalEduAIApp.tsx:508) and the preview and
 * download paths (1857, 1938-1951). Every one of them had to remember the
 * revoke, and `blob:` URLs pin their bytes in memory until it happens.
 *
 * Two things the original got right and this keeps:
 *
 *  - it is keyed on the *id*, not on the file object. `answerFile` is a fresh
 *    object every render, so depending on it revoked and recreated the URI on
 *    each pass.
 *  - a load that finishes after the id has moved on is dropped and its handle
 *    released immediately, rather than being shown against the wrong file.
 *
 * The resolved URI is held together with the id it belongs to and compared on
 * the way out, rather than being cleared from the effect. That is what makes a
 * change of id show "" on the very first render after the change - clearing it
 * in the effect would paint the previous file's URI once more first - and it
 * keeps this hook free of the synchronous setState-in-effect that React's
 * compiler rules reject.
 *
 * On native `openFile` hands back a `file://` URI and `release()` is a no-op,
 * so the same call works for <Image>, expo-sharing and a WebView.
 *
 * Returns "" while loading, and "" when the file is not in the store - which is
 * what the source pane rendered as "no preview available".
 */
export function useFileUri(id?: string | null): string {
  const [opened, setOpened] = useState<{ id: string; uri: string } | null>(null);

  useEffect(() => {
    if (!id) return;

    let active = true;
    let handle: OpenFile | null = null;

    void (async () => {
      let file: OpenFile | null = null;
      try {
        file = await openFile(id);
      } catch {
        // A missing or unreadable file is not an error the caller can act on;
        // the empty URI is the signal, exactly as it was in the web app.
        file = null;
      }
      if (!active) {
        file?.release();
        return;
      }
      handle = file;
      setOpened({ id, uri: file?.uri ?? '' });
    })();

    return () => {
      active = false;
      handle?.release();
    };
  }, [id]);

  return opened && opened.id === id ? opened.uri : '';
}
