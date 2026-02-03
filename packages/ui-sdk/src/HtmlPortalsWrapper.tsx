import * as portals from "react-reverse-portal";

/** Use class to keep immer happy */
export class HtmlPortalWrapper {
  portalNode: portals.HtmlPortalNode;
  constructor() {
    this.portalNode = portals.createHtmlPortalNode({
      attributes: { style: "width: 100%; height: 100%;" },
    });
  }
}
