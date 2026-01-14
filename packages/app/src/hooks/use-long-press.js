import { isTouchDevice } from "@npc-cli/util/legacy/dom";
import React from "react";

/**
 * - Based on https://stackoverflow.com/a/54749871/2917822
 * - Invokes `config.onClick` if press isn't long enough.
 * - On touchstart will only consider touchevents
 * @param {Config} config
 */
export default function useLongPress(config) {
  const ms = config.ms ?? 0;
  const timerId = React.useRef(-1);
  const epochMs = React.useRef(-1);
  const lastPos = React.useRef({ clientX: 0, clientY: 0 });

  /** @param {{ clientX: number, clientY: number }} firstPos */
  function onTimeout(firstPos) {
    if (
      Math.hypot(
        lastPos.current.clientX - firstPos.clientX,
        lastPos.current.clientY - firstPos.clientY,
      ) < 3
    ) {
      config.onLongPress({
        clientX: firstPos.clientX,
        clientY: firstPos.clientY,
      });
    }
  }

  return React.useMemo(
    () => ({
      ...(isTouchDevice()
        ? {
            /** @param {React.TouchEvent} e */
            onTouchStart(e) {
              if (e.touches.length > 1) return;
              const firstPos = { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
              timerId.current = window.setTimeout(() => onTimeout(firstPos), config.ms);
              epochMs.current = Date.now();
            },
            /** @param {React.TouchEvent} e */
            onTouchMove(e) {
              lastPos.current = {
                clientX: e.touches[0].clientX,
                clientY: e.touches[0].clientY,
              };
            },
            /** @param {React.TouchEvent} e */
            onTouchEnd(e) {
              clearTimeout(timerId.current);
              Date.now() - epochMs.current < ms && config.onClick?.(e);
            },
          }
        : {
            /** @param {React.MouseEvent} e */
            onMouseDown(e) {
              const firstPos = { clientX: e.clientX, clientY: e.clientY };
              timerId.current = window.setTimeout(() => onTimeout(firstPos), config.ms);
              epochMs.current = Date.now();
            },
            /** @param {React.MouseEvent} e */
            onMouseMove(e) {
              lastPos.current = { clientX: e.clientX, clientY: e.clientY };
            },
            /** @param {React.MouseEvent} e */
            onMouseUp(e) {
              clearTimeout(timerId.current);
              Date.now() - epochMs.current < ms && config.onClick?.(e);
            },
          }),
      onMouseLeave() {
        clearTimeout(timerId.current);
      },
      /** @param {React.KeyboardEvent} e */
      onKeyDown(e) {
        clearTimeout(timerId.current);
        ["Enter", " "].includes(e.key) && config.onClick?.(e);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config.onLongPress, config.onClick, ms],
  );
}

/**
 * @typedef Config
 * @property {(longPressData: LongPressData) => void} onLongPress
 * @property {(e: React.MouseEvent | React.TouchEvent | React.KeyboardEvent) => void} [onClick]
 * @property {number} [ms]
 */

/**
 * @typedef {object} LongPressData
 * @property {number} clientX
 * @property {number} clientY
 */
