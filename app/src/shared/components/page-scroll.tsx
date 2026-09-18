/**
 * The workspace's scrolling region, handed to whatever is rendered inside it.
 *
 * A screen that wants to bring one of its own rows into view cannot do it
 * alone: the vertical `ScrollView` belongs to the shell, and nothing in a
 * module's props reaches it. On web that did not matter - react-native-web
 * hands back the DOM node and `scrollIntoView` does the work - so the review
 * navigator's "jump to question" moved the page there and silently did nothing
 * on a device.
 *
 * This is the smallest thing that closes it: the shell publishes a scroller,
 * and a screen asks it to reveal a node it has a ref to. It lives in `shared/`
 * because both sides are features, and `shared/` may not import from them.
 */

import { createContext, useContext, useMemo } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { ScrollView, View } from 'react-native';

/** Breathing room above a revealed node, so it is not flush with the top bar. */
const REVEAL_INSET = 12;

/**
 * `getInnerViewRef` is the content view every child is laid out against;
 * measuring against the ScrollView itself returns a position that is already
 * scrolled. React Native types it as "undocumented" and points at the
 * `innerViewRef` prop instead, which react-native-web does not implement -
 * both runtimes do implement this method, so it is the one path that works on
 * a device and in the browser. Declared here because neither side types it.
 */
type WithInnerView = { getInnerViewRef?: () => View | null };

type PageScroll = {
  /** Scroll the shell so `node` sits at the top of the viewport. */
  reveal: (node: View | null | undefined) => void;
};

const noop: PageScroll = { reveal: () => {} };

const PageScrollContext = createContext<PageScroll>(noop);

/**
 * Outside a `PageScrollProvider` this is inert rather than an error: a screen
 * rendered in a dialog or a test has no shell to scroll, and refusing to
 * render would be a worse answer than not scrolling.
 */
export function usePageScroll(): PageScroll {
  return useContext(PageScrollContext);
}

export function PageScrollProvider({
  scrollRef,
  children,
}: {
  scrollRef: RefObject<ScrollView | null>;
  children: ReactNode;
}) {
  const value = useMemo<PageScroll>(
    () => ({
      reveal: (node) => {
        const scroll = scrollRef.current;
        const inner = (scroll as unknown as WithInnerView | null)?.getInnerViewRef?.();
        if (!scroll || !inner || !node?.measureLayout) return;
        node.measureLayout(
          inner as Parameters<NonNullable<View['measureLayout']>>[0],
          (_x, y) =>
            scroll.scrollTo({
              y: Math.max(0, y - REVEAL_INSET),
              animated: true,
            }),
          // A node unmounted between the tap and the measurement: nothing to
          // reveal, and throwing here would take the screen down with it.
          () => {},
        );
      },
    }),
    [scrollRef],
  );

  return <PageScrollContext.Provider value={value}>{children}</PageScrollContext.Provider>;
}
