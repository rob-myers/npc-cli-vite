#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path/posix";
import { Document, NodeIO } from "@gltf-transform/core";
import { PROJECT_ROOT } from "../const.ts";

const doc = new Document();
const buffer = doc.createBuffer();

// biome-ignore format: data array for mapping
const vertices = new Float32Array(
  [
    -1, -1,  1,   1, -1,  1,   1,  1,  1,  -1,  1,  1, // Front
    -1, -1, -1,   1, -1, -1,   1,  1, -1,  -1,  1, -1  // Back
  ],
);
// biome-ignore format: data array for mapping
const indices = new Uint16Array([
    0, 1, 2,  2, 3, 0, // front
    1, 5, 6,  6, 2, 1, // right
    7, 6, 5,  5, 4, 7, // back
    4, 0, 3,  3, 7, 4, // left
    4, 5, 1,  1, 0, 4, // bottom
    3, 2, 6,  6, 7, 3  // top
]);

// 2. Create Accessors
const posAccessor = doc.createAccessor().setType("VEC3").setArray(vertices).setBuffer(buffer);
const indAccessor = doc.createAccessor().setType("SCALAR").setArray(indices).setBuffer(buffer);

// 3. Create Mesh and Primitive
const prim = doc.createPrimitive().setAttribute("POSITION", posAccessor).setIndices(indAccessor);
const mesh = doc.createMesh("CubeMesh").addPrimitive(prim);

// 4. Create Node (Group) and Scene
const node = doc.createNode("CubeNode").setMesh(mesh);
const myGroup = doc.createNode("MyGroup").addChild(node);
const _scene = doc.createScene("MainScene").addChild(myGroup);

const io = new NodeIO();

const outputPath = join(PROJECT_ROOT, "packages/media/src/gltf/test/model.gltf");
const outputDir = dirname(outputPath);
mkdirSync(outputDir, { recursive: true });

const { json, resources } = await io.writeJSON(doc);

if (json.buffers) {
  for (const [uri, buffer] of Object.entries(resources)) {
    const base64 = Buffer.from(buffer).toString("base64");

    const bufferIndex = json.buffers.findIndex((b) => b.uri === uri);
    if (bufferIndex === -1) continue;

    json.buffers[bufferIndex].uri = `data:application/octet-stream;base64,${base64}`;
  }
}

writeFileSync(outputPath, JSON.stringify(json, null, 2));
