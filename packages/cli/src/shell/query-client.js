import { QueryClient } from "@tanstack/react-query";

export let queryClient = new QueryClient();
export let queryCache = queryClient.getQueryCache();

/**
 * Can override default query client e.g. use app's
 * @param {QueryClient} client
 */
export function setQueryClient(client) {
  if (queryClient === client) {
    return;
  }
  queryClient.clear();
  queryClient = client;
  queryCache = queryClient.getQueryCache();
}

/**
 * @param {string | string[]} queryKey
 * @returns {any | undefined}
 */
export function getCached(queryKey) {
  return queryCache.find({
    queryKey: Array.isArray(queryKey) ? queryKey : [queryKey],
  })?.state.data;
}

/**
 * @template T
 * @param {string[]} queryKey
 * @param {import('@tanstack/react-query').Updater<T | undefined, T>} updater
 */
export function setCached(queryKey, updater) {
  // 🚧 review options
  queryClient.setQueryDefaults(queryKey, {
    gcTime: Infinity,
    staleTime: Infinity,
  });
  queryClient.setQueryData(queryKey, updater);
}

/**
 * @param {string[]} queryKey
 */
export function removeCached(queryKey) {
  const query = queryCache.find({ queryKey });
  query && queryCache.remove(query);
}
