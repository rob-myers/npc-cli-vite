import React from "react";
import { useUpdate } from "./use-update";

/**
 * This hook is a mixture of `React.useState` and `React.useRef`.
 * - It outputs an object of type `State` which:
 *   - is always the same object.
 *   - is typically a dictionary of functions and values.
 *   - is designed to be mutated by these functions.
 * - Its `initializer` is a parameterless function constructing this object.
 * - On HMR it will update these properties "suitably", relative to options.
 *
 * @template {Record<string, any>} State
 * @param {() => State} initializer Should be side-effect free.
 * @param {Options<State>} [opts]
 */
export function useStateRef(initializer, opts = {}) {
  const [state] = /** @type {[UseStateRef<State>, any]} */ (React.useState(initializer));
  const update = useUpdate();

  React.useMemo(() => {
    const changed = initializer.toString() !== state._prevFn;

    if (!state._prevFn) {
      /**
       * Initial mount
       * 🚧 avoid invocation in production
       */
      state._prevFn = initializer.toString();

      // Provide useUpdate wrapper `set`
      state.set = (partial) => {
        Object.assign(state, partial);
        update();
      };
    } else {
      /**
       * Either HMR or `opts.deps` has changed.
       * If HMR and `initializer` changed, we may need to update state with new functions, and add/remove keys.
       * If HMR and `initializer` has not changed, the original constructor of the state may have changed elsewhere in codebase.
       *
       * Attempt to update state using new initializer:
       * - update all functions
       * - add new properties
       * - remove stale keys
       * - we don't support getters or setters
       */
      const newInit = initializer();

      for (const [k, v] of Object.entries(newInit)) {
        // console.log({ key: k })
        const key = /** @type {keyof State} */ (k);

        if (typeof v === "function" && opts.ignore?.[key] !== true) {
          state[key] = v;
        } else if (!(k in state)) {
          // console.log({ setting: [k, v] })
          state[key] = v;
        } else if (opts.reset?.[key] === true) {
          state[key] = v;
        }
      }

      for (const k of Object.keys(state)) {
        if (!(k in newInit) && k !== "_prevFn" && k !== "update" && k !== "set") {
          // console.log({ deleting: k })
          delete state[/** @type {keyof State} */ (k)];
        }
      }

      if (changed) {
        state._prevFn = initializer.toString();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, opts.deps ?? []);

  return state;
}

// import.meta.webpackHot?.decline();

/**
 * @template {Record<string, any>} State
 * @typedef Options
 * @property {Partial<Record<keyof State, boolean>>} [ignore] Ignore function field(s) on HMR?
 * @property {Partial<Record<keyof State, boolean>>} [reset] Reset field(s) on HMR?
 * @property {any[]} [deps]
 */

/**
 * @template {Record<string, any>} State
 * @typedef {State & {
 *   _prevFn?: string;
 *   set(partial?: Partial<State>): void;
 * }} UseStateRef
 * The state returned by `useStateRef`, which includes a special function `ref`.
 */
