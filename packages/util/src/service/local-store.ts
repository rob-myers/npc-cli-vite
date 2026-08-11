import { tryLocalStorageGetParsed, tryLocalStorageRemove, tryLocalStorageSet } from "../legacy/generic";

export type LocalStore<T extends object> = {
  /** Stored fields merged over `defaults`, so one bad field cannot lose the rest */
  read: () => T;
  /** Merge `part` in, writing after `debounceMs` */
  patch: (part: Partial<T>) => void;
  /** Write any pending `patch` at once, e.g. on `beforeunload` */
  flush: () => void;
  remove: () => void;
};

/**
 * A single localStorage key holding one JSON object, rather than a key per field.
 *
 * Writes are debounced because e.g. a slider drag patches on every input event,
 * and each write re-serialises the whole object.
 */
export function createLocalStore<T extends object>(
  key: string,
  defaults: T,
  { debounceMs = 200, version = 1 }: { debounceMs?: number; version?: number } = {},
): LocalStore<T> {
  /** `undefined` until first read; thereafter the live value */
  let current: undefined | T;
  let timeoutId: undefined | ReturnType<typeof setTimeout>;

  function write() {
    timeoutId = undefined;
    tryLocalStorageSet(key, JSON.stringify({ ...current, v: version }));
  }

  return {
    read() {
      if (current === undefined) {
        const stored = tryLocalStorageGetParsed<T & { v?: number }>(key);
        // a version bump discards the object wholesale, unlike a merely absent field
        current =
          stored === null || typeof stored !== "object" || stored.v !== version
            ? { ...defaults }
            : mergeDefined(defaults, stored);
      }
      return current;
    },
    patch(part) {
      current = { ...this.read(), ...part };
      clearTimeout(timeoutId);
      timeoutId = setTimeout(write, debounceMs);
    },
    flush() {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
        write();
      }
    },
    remove() {
      clearTimeout(timeoutId);
      timeoutId = undefined;
      current = { ...defaults };
      tryLocalStorageRemove(key);
    },
  };
}

/** `stored`'s fields override `defaults`, ignoring those it lacks or left `undefined` */
function mergeDefined<T extends object>(defaults: T, stored: Partial<T>): T {
  const output = { ...defaults };
  for (const k of Object.keys(defaults) as (keyof T)[]) {
    if (stored[k] !== undefined) {
      output[k] = stored[k] as T[keyof T];
    }
  }
  return output;
}

/** Every localStorage key starting with `prefix` */
export function listLocalStorageKeys(prefix: string): string[] {
  const output = [] as string[];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key !== null && key.startsWith(prefix)) {
        output.push(key);
      }
    }
  } catch {
    // e.g. storage disabled
  }
  return output;
}

/** Remove every localStorage key satisfying `predicate` */
export function removeLocalStorageKeys(predicate: (key: string) => boolean): void {
  try {
    const doomed = [] as string[];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key !== null && predicate(key)) {
        doomed.push(key);
      }
    }
    doomed.forEach((key) => tryLocalStorageRemove(key, false));
  } catch {
    // e.g. storage disabled
  }
}
