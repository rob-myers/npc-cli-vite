export type BuildInfo = { id: string; at: string };

const meta = (name: string) => document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content;

/** The running build, from the `<meta>`s `buildIdPlugin` writes into `index.html` */
export function getBuildInfo(): BuildInfo | null {
  const id = meta("build-id");
  return id ? { id, at: meta("build-at") ?? "" } : null;
}

/** `?simulateStale=<uiKey>` fails that ui's lazy load, as a deploy removing its chunk would */
export const simulatedStaleUi = new URLSearchParams(location.search).get("simulateStale");

/** The deployed build, or `null` if unreachable. Simulating, a build from now */
export async function fetchLatestBuild(): Promise<BuildInfo | null> {
  if (simulatedStaleUi) return { id: "simulated", at: new Date().toISOString() };
  try {
    const json = await (await fetch("/version.json", { cache: "no-store" })).json();
    return typeof json?.id === "string" ? { id: json.id, at: typeof json.at === "string" ? json.at : "" } : null;
  } catch {
    return null; // offline, or mid-deploy
  }
}
