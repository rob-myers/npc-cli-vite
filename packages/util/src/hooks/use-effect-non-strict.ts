import { type DependencyList, useEffect, useRef } from "react";

/**
 * Bypass `<StrictMode>` in development.
 */
export function useEffectNonStrict(fn: () => (() => void) | void, deps: DependencyList) {
  const cleanupRef = useRef<void | (() => void)>(undefined);

  useEffect(() => {
    if (import.meta.env.PROD) return fn();

    // usual hasRun.current ref trick wouldn't work for tanstack mutation
    // See: https://github.com/TanStack/query/issues/5341#issuecomment-1667408136
    const timeoutId = setTimeout(() => {
      cleanupRef.current = fn();
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      cleanupRef.current?.();
    };
  }, deps);
}
