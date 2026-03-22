import * as cliQueryClient from "@npc-cli/cli/shell/query-client";
import * as worldQueryClient from "@npc-cli/ui__world/query-client";
import { QueryClientApi } from "@npc-cli/util";

export const queryClientApi = new QueryClientApi();

// connect CLI and World
cliQueryClient.setQueryClientApi(queryClientApi);
worldQueryClient.setQueryClientApi(queryClientApi);

// 🔔 use <ReactQueryDevtools> to avoid DataCloneError from chrome devtools when cache World
// if (import.meta.env.DEV) {
//   // biome-ignore lint/suspicious/noExplicitAny: devtools hook
//   (window as any).__TANSTACK_QUERY_CLIENT__ = queryClientApi.queryClient;
// }
