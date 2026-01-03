// @ts-nocheck
import { renderToString } from "react-dom/server";
import { dangerouslySkipEscape, escapeInject } from "vike/server";

/**
 * @param {*} pageContext
 * @returns {*}
 */
export async function onRenderHtml(pageContext) {
  const { Page } = pageContext;
  const pageHtml = dangerouslySkipEscape(renderToString(<div>Foo bar baz</div>));

  return escapeInject`
    <!doctype html>
    <html lang="en" class="bg-background">
      <head>
        <meta charset="UTF-8" />
        <link rel="icon" type="image/svg+xml" href="/vite.svg" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>NPC CLI</title>
        <link href="/src/styles/main.css" rel="stylesheet">
      </head>
      <body>
        <div id="root">${pageHtml}</div>
        <!-- <script type="module" src="/src/main.tsx"></script> -->
      </body>
    </html>
  `;
}
