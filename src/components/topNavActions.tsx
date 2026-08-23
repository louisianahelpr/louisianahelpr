import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * A slot that lets a page hand its own controls to the global desktop app bar
 * ({@link DesktopTopNav}, rendered once from App.tsx).
 *
 * WHY A SLOT AND NOT A PROP: the bar is rendered globally, as a sibling of the
 * router — that is what makes it appear on every signed-in page including the
 * document-scroll ones that never mount AppShell. But it means a page cannot
 * pass it anything directly; they are in different branches of the tree. The
 * page writes here, the bar reads here.
 *
 * The alternative — threading a `header` prop through each page — is what this
 * replaced: it required every screen to opt in, so pages were missed and any
 * new page started life with no bar at all.
 *
 * Pages MUST memoise the node they pass (see {@link useTopNavActions}), or the
 * effect re-fires every render and loops.
 */
type TopNavActionsValue = {
  actions: ReactNode;
  setActions: (node: ReactNode) => void;
};

const TopNavActionsContext = createContext<TopNavActionsValue>({
  actions: null,
  setActions: () => {},
});

export const TopNavActionsProvider = ({ children }: { children: ReactNode }) => {
  const [actions, setActions] = useState<ReactNode>(null);
  const value = useMemo(() => ({ actions, setActions }), [actions]);
  return (
    <TopNavActionsContext.Provider value={value}>
      {children}
    </TopNavActionsContext.Provider>
  );
};

/** Read side — used by DesktopTopNav only. */
export const useTopNavActionsSlot = () => useContext(TopNavActionsContext).actions;

/**
 * Write side. Call from a page with a MEMOISED node:
 *
 *   const actions = useMemo(() => <>…</>, [deps]);
 *   useTopNavActions(actions);
 *
 * Clears itself on unmount, so navigating away never leaves the previous
 * page's controls stranded in the bar.
 *
 * Pass `null` (or skip the call) on a page with nothing to contribute — the
 * bar then renders just the emblem and the bell.
 */
export const useTopNavActions = (node: ReactNode) => {
  const { setActions } = useContext(TopNavActionsContext);
  useEffect(() => {
    setActions(node);
    return () => setActions(null);
  }, [node, setActions]);
};
