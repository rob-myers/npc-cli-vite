import { useEffect, useRef } from "react";
import { useBeforeunload } from "react-beforeunload";

/**
 * Persist on the way out, however that happens: the page going (`beforeunload`), the tab being
 * hidden (`visibilitychange`), or this component alone going — closing its tab within the app,
 * which fires neither event. See `onDeleteTab` in `Tabs`
 */
export function useBeforeUnloadOrVisibilityChange(callback: () => void) {
  useBeforeunload(callback);

  // the latest callback, so neither the listener nor the unmount below goes stale — and an inline
  // arrow's fresh identity each render does not resubscribe them
  const latest = useRef(callback);
  latest.current = callback;

  useEffect(() => {
    const onVisibilityChange = () => latest.current();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      latest.current();
    };
  }, []);
}
