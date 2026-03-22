import { MapsManifestSchema } from "@npc-cli/ui__map-edit/map-node-api";
import { fetchParsed } from "@npc-cli/util/fetch-parsed";
import { useQuery } from "@tanstack/react-query";

export function useMapManifest() {
  return useQuery({
    queryKey: ["map-manifest"],
    queryFn: () => fetchParsed("/map/manifest.json", MapsManifestSchema),
    staleTime: 60_000,
  });
}
