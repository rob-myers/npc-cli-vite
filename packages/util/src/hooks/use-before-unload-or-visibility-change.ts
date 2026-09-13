import { useEffect } from "react";
import { useBeforeunload } from "react-beforeunload";

export function useBeforeUnloadOrVisibilityChange(callback: () => void) {
  useBeforeunload(callback);

  useEffect(() => {
    document.addEventListener("visibilitychange", callback);
    return () => document.removeEventListener("visibilitychange", callback);
  }, [callback]);
}
