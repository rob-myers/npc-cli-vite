#!/usr/bin/env node

import assets from "../../../packages/app/public/assets.json" with { type: "json" };

const [leafNodes] = assets.stratifiedSymbolNodes;
const symbolKeys = leafNodes.map((node) => node.id);

console.log({ symbolKeys });
