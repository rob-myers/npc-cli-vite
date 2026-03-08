import { keepPreviousData, QueryCache, QueryClient, type Updater } from "@tanstack/react-query";

export class QueryClientApi {
  queryClient: QueryClient;
  queryCache: QueryCache;

  constructor() {
    this.queryClient = new QueryClient({
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
