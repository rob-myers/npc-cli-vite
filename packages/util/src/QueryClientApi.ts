import { type QueryCache, QueryClient, type Updater } from "@tanstack/react-query";

export class QueryClientApi {
  queryClient: QueryClient;
  queryCache: QueryCache;

  constructor() {
    this.queryClient = new QueryClient();
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
      gcTime: Infinity,
      staleTime: Infinity,
    });
    this.queryClient.setQueryData(queryKey, updater);
  }
}
