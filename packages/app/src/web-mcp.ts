/** Its tools are offered only where the browser has WebMCP, and only once switched on in the main menu */
const storageKey = "web-mcp";

/** The browser offers `document.modelContext` — see `docs/mcp.md` */
export function hasWebMcp(): boolean {
  return "modelContext" in document;
}

/** Off by default */
export function isWebMcpOn(): boolean {
  try {
    return localStorage.getItem(storageKey) === "on";
  } catch {
    return false;
  }
}

/** Saves the choice, then registers or unregisters the tools */
export async function setWebMcpOn(on: boolean) {
  try {
    if (on) localStorage.setItem(storageKey, "on");
    else localStorage.removeItem(storageKey);
  } catch {}
  if (hasWebMcp() === false) return;
  const tools = await import("./web-mcp-tools");
  if (on) tools.startWebMcpTools();
  else tools.stopWebMcpTools();
}
