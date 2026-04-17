import { keepPreviousData, QueryCache, QueryClient, type Updater } from "@tanstack/react-query";

export class QueryClientApi {
  queryClient: QueryClient;
  queryCache: QueryCache;

  constructor() {
    this.queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          refetchOnReconnect: import.meta.env.DEV ? false : undefined,
          refetchOnWindowFocus: import.meta.env.DEV ? false : undefined,
          gcTime: Infinity,
        },
      },
      queryCache: new QueryCache({
        // Always log query errors
        onError: (error) => console.error(error),
      }),
    });
    this.queryCache = this.queryClient.getQueryCache();
  }

  clear() {
    this.queryCache.clear();
  }

  get(queryKey: string | string[]) {
    return this.queryCache.find({
      queryKey: Array.isArray(queryKey) ? queryKey : [queryKey],
    })?.state.data;
  }

  remove(queryKey: string | string[]) {
    const found = this.queryCache.find({ queryKey: Array.isArray(queryKey) ? queryKey : [queryKey] });
    if (found) {
      this.queryCache.remove(found);
    }
  }

  set<T>(queryKey: string[], updater: Updater<T | undefined, T>) {
    this.queryClient.setQueryDefaults(queryKey, {
      staleTime: Number.POSITIVE_INFINITY,
      throwOnError: (error) => {
        console.error(error);
        return false;
      },
      placeholderData: keepPreviousData,
    });
    this.queryClient.setQueryData(queryKey, updater);
  }
}
