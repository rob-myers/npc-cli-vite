// https://vike.dev/onRenderClient
export { onRenderClient };

import { hydrateRoot } from "react-dom/client";

/**
 * @param {*} pageContext
 */
async function onRenderClient(pageContext) {
  const { Page } = pageContext;
  hydrateRoot(
    /** @type {HTMLElement} */ (document.getElementById("root")),
    <div>
      Foo bar baz
      {/* <Page /> */}
    </div>,
  );
}
