/**
 * Source:
 * https://github.com/ardatan/graphql-tools/blob/master/packages/utils/src/observableToAsyncIterable.ts
 */

/**
 * @template T
 * @param {import('./Broadcaster.js').Broadcaster<T>} observable
 * @returns {AsyncIterableIterator<T>}
 */
export function observableToAsyncIterable(observable) {
  const pullQueue = /** @type {Array<Callback>} */ ([]);
  const pushQueue = /** @type {Array<any>} */ ([]);

  let listening = true;

  /** @param {any} value */
  const pushValue = (value) => {
    if (pullQueue.length !== 0) {
      // It is safe to use the ! operator here as we check the length.
      /** @type {Callback} */ (pullQueue.shift())({ value, done: false });
    } else {
      pushQueue.push({ value, done: false });
    }
  };

  /** @param {any} error */
  const pushError = (error) => {
    if (pullQueue.length !== 0) {
      // It is safe to use the ! operator here as we check the length.
      /** @type {Callback} */ (pullQueue.shift())({ value: { errors: [error] }, done: false });
    } else {
      pushQueue.push({ value: { errors: [error] }, done: false });
    }
  };

  const pushDone = () => {
    if (pullQueue.length !== 0) {
      // It is safe to use the ! operator here as we check the length.
      /** @type {Callback} */ (pullQueue.shift())({ done: true });
    } else {
      pushQueue.push({ done: true });
    }
  };

  const pullValue = () =>
    /** @type {Promise<IteratorResult<T>>} */ (
      new Promise((resolve) => {
        if (pushQueue.length !== 0) {
          const element = pushQueue.shift();
          // either {value: {errors: [...]}} or {value: ...}
          resolve(element);
        } else {
          pullQueue.push(resolve);
        }
      })
    );

  const subscription = observable.subscribe({
    next(value) {
      pushValue(value);
    },
    error(err) {
      pushError(err);
    },
    complete() {
      pushDone();
    },
  });

  const emptyQueue = () => {
    if (listening) {
      listening = false;
      subscription.unsubscribe();
      for (const resolve of pullQueue) {
        resolve({ value: undefined, done: true });
      }
      pullQueue.length = 0;
      pushQueue.length = 0;
    }
  };

  return {
    next() {
      // return is a defined method, so it is safe to call it.
      return listening ? pullValue() : /** @type {*} */ (this.return)();
    },
    return() {
      emptyQueue();
      return Promise.resolve({ value: undefined, done: true });
    },
    throw(error) {
      emptyQueue();
      return Promise.reject(error);
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}

/**
 * @template T
 * @typedef Observer
 * @property {(value: T) => void} next
 * @property {(error: Error) => void} error
 * @property {() => void} complete
 */

// /**
//  * @template T
//  * @typedef Observable
//  * @property {(observer: Observer<T>) => { unsubscribe(): void }} subscribe
//  */

/**
 * @typedef {(value?: any) => any} Callback
 */
