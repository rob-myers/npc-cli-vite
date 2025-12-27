import { setQueryClientApi } from "@npc-cli/cli";
import { QueryClientApi } from "@npc-cli/util";

export const queryClientApi = new QueryClientApi();

setQueryClientApi(queryClientApi);

if (import.meta.env.DEV) {
  // biome-ignore lint/suspicious/noExplicitAny: devtools hook
  (window as any).__TANSTACK_QUERY_CLIENT__ = queryClientApi.queryClient;
}
