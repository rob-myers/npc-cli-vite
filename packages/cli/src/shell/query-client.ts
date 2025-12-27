import { QueryClientApi } from "@npc-cli/util";

export let queryClientApi = new QueryClientApi();

/** Can use e.g. app's query client instead */
export function setQueryClientApi(input: QueryClientApi) {
  queryClientApi = input;
}
