# Blockbench

Npc models are made in Blockbench, which Claude Code can drive through an MCP plugin:

- https://github.com/jasonjgardner/blockbench-mcp-plugin
- plugin script: https://jasonjgardner.github.io/blockbench-mcp-plugin/mcp.js
- in VSCode Claude Code, `/mcp` — possibly reconnect

## Tips

- Can select a model face.
- Can drag a UV square area (not diagonally).
- Select two objects, then Cmd+Drag to create a box, e.g. of vertices.
- `z` toggles wireframe.
- RMB translates the view.
- Import GLTF seems to cache the file unless you close it and choose it again.
- Personal keybinding: Shift+P for the perspective camera.

## Exporting

The model is `packages/media/src/blockbench/current/current.bbmodel`. Export it as glTF to `current.gltf` beside it: ascii, embedded textures, armature, animations.
- **Animation Sample Rate is 48** (Settings, Export). A smooth (catmullrom) curve is sampled at that rate, but the exporter drops any sample within one interval of a keyframe. Many clips have keyframes every 1/12s, so at the default 24 nearly every sample is dropped, and the curve becomes straight lines. At 48 every 1/24s sample is kept, and each clip plays as Blockbench previews it.
- A DEV World loads `current.gltf`, and refetches it on each export (`docs/mcp.md`).
- The dev server, and the pre-commit hook, write `current.glb` from it (`gen-current-glb`), which production loads. It is deduped, pruned and resampled: a keyframe its neighbours' line matches to within about 2° goes (`resampleTolerance`, 5e-4). That keeps it smaller than a 24 export's, about 77KB brotlied.
- Compare sizes with `pnpm compare-brotli packages/media/src/blockbench/current/current.glb`.

## A new clip

1. Make it in Blockbench and export, as above. Name it as the World will, e.g. `talk_left`, without Blockbench's `animation.` prefix.
2. Add it to `fromAnimationClipKey` in `const.npc.ts`, and to the fade table below it (`{}` for the default fade).
3. An upper clip over one arm, e.g. `point` or `talk_left`, is posed by jsh `pose rob as:talk_left` once it is in `poseConfig.poses`, with its arm (`side`) and the clip it draws in to near others (`avoid`, else `null`). Only a right arm's pose aims at whom it is `at`.

`talk_left` is the left arm talking: a 2.4s loop of the forearm raised and beating, with an open gesture midway. It moves `leftarm` and `leftforearm` alone, so it plays beside a right arm's pose.
