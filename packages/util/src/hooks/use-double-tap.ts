import { useCallback, useRef } from "react";

/**
 * https://github.com/minwork/react/blob/main/packages/use-double-tap/src/lib/use-double-tap.ts
 *
 * @param callback - The function to be called on a double tap event.
 * @param threshold - The time in milliseconds that defines the interval between single taps for them to be considered a double tap. Default is 300 ms.
 * @return An object with an onClick handler.
 */
export function useDoubleTap(callback: (e: MouseEvent) => void, threshold = 300) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handler = useCallback(
    (event: MouseEvent) => {
      if (!timer.current) {
        timer.current = setTimeout(() => {
          timer.current = null;
        }, threshold);
      } else {
        clearTimeout(timer.current);
        timer.current = null;
        callback(event);
      }
    },
    [callback, threshold],
  );
  return { onClick: handler };
}
