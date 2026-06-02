import { useBeforeunload } from "react-beforeunload";

export function useBeforeUnloadOrVisibilityChange(callback: () => void) {
  useBeforeunload(callback);

  document.addEventListener("visibilitychange", callback);

  return () => {
    document.removeEventListener("visibilitychange", callback);
  };
}
