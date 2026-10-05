const urls = import.meta.glob<string>("./*-icon.svg", { eager: true, query: "?url", import: "default" });

/** The inventory bar's drawings by item kind e.g. `book` — bundled, so hashed in a build and hot in DEV */
export const itemIconUrl = Object.fromEntries(
  Object.entries(urls).map(([path, url]) => [path.slice("./".length, -"-icon.svg".length), url]),
);
