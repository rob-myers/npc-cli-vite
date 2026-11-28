import type * as THREE from "three/webgpu";
import type { State as WorldState } from "../components/World";
import { warmTexturePipelines } from "./warm-texture-pipelines";

/**
 * Until booted, pipelines compile off the GPU's frame thread, the first look's first.
 * Texture pipelines compile now.
 */
export function prepareBootPipelines(w: WorldState) {
  const renderer = w.r3f.gl as unknown as THREE.WebGPURenderer;
  deferPipelines(renderer, {
    booted: () => (w.e?.bootedAt ?? 0) > 0,
    redraw: () => w.r3f?.invalidate(),
    later: laterThanFirstLook(w.r3f.scene),
  });
  warmTexturePipelines(renderer);
  performance.mark(`${w.key}:warm-textures`);
}

/**
 * Until `booted()`, a draw or compute needing a new pipeline has Dawn create it off the GPU's frame thread,
 * and is skipped until it is ready. three creates them synchronously, which on a cold GPU stops frames for each.
 */
function deferPipelines(renderer: unknown, opts: DeferOpts): void {
  const { _pipelines: pipelines, backend } = renderer as ThreeRenderer;
  if (pipelines.deferred === true) return;
  Object.assign(pipelines, { deferred: true, pending: 0, holding: true, redraw: opts.redraw });

  /** Counts it whilst compiling, then asks for the frame that draws with it */
  const track = (promise: Promise<unknown>) => {
    pipelines.pending++;
    void promise.finally(() => pipelines.pending--).then(opts.redraw, ignore);
  };

  pipelines.updateForRender = (renderObject) => {
    if (opts.booted()) return void pipelines.getForRender(renderObject);
    if (mayAsk(pipelines, renderObject, opts) === false) return; // no pipeline, so three skips the draw
    const promises: Promise<void>[] = [];
    pipelines.getForRender(renderObject, promises);
    promises.length > 0 && track(Promise.all(promises));
  };

  // three has no async compute pipeline, so this is its own, made async
  const { pipelineUtils, device } = backend;
  const createCompute = pipelineUtils.createComputePipeline.bind(pipelineUtils);
  pipelineUtils.createComputePipeline = (pipeline, bindings) => {
    if (opts.booted()) return createCompute(pipeline, bindings);
    const bindGroupLayouts = bindings.map((group) => backend.get(group).layout.layoutGPU);
    const layout = device.createPipelineLayout({ bindGroupLayouts });
    track(
      device
        .createComputePipelineAsync({ compute: backend.get(pipeline.computeProgram).module, layout })
        .then((gpu) => void (backend.get(pipeline).pipeline = gpu)),
    );
  };

  const compute = backend.compute.bind(backend);
  /** A dispatch whose pipeline is still compiling is skipped */
  backend.compute = (group, node, bindings, pipeline, size) =>
    backend.get(pipeline).pipeline === undefined ? undefined : compute(group, node, bindings, pipeline, size);
}

/**
 * Resolves with the ms waited, once no deferred pipeline has compiled for `frames` frames running, or after `maxMs`.
 * So whatever is drawn so far is on screen before frames are held. Held draws are let go once the rest are done.
 */
export async function pipelinesSettled(renderer: unknown, frames = 3, maxMs = 8000): Promise<number> {
  const pipelines = (renderer as ThreeRenderer | undefined)?._pipelines;
  if (pipelines === undefined) return 0;
  const start = performance.now();
  const until = start + maxMs;
  for (let quiet = 0; quiet < frames && performance.now() < until; ) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (pipelines.pending > 0) quiet = 0;
    else if (pipelines.holding === true) {
      letGo(pipelines);
      quiet = 0;
    } else quiet++;
  }
  if (pipelines.holding === true) letGo(pipelines); // after `maxMs`
  return performance.now() - start;
}

/** Draws in `scene` besides what a first map shows, i.e. those `pipelinesSettled` holds */
function laterThanFirstLook(scene: object) {
  return (renderObject: RenderObject) =>
    renderObject.scene === scene && firstLookMaterials.has(renderObject.material.name) === false;
}

/**
 * Whether a draw may ask for its pipeline now. A `later` draw waits whilst held, and a new
 * pipeline waits for one of `maxCompiling`: more at once stalled a cold GPU's frames.
 */
function mayAsk(pipelines: ThreeRendererPipelines, renderObject: RenderObject, opts: DeferOpts) {
  if (pipelines.get(renderObject).pipeline !== undefined) return true;
  if (pipelines.holding === true && opts.later(renderObject) === true) return false;
  return pipelines.pending < maxCompiling;
}

/** Lets held draws ask for their pipelines, from the next frame */
function letGo(pipelines: ThreeRendererPipelines) {
  pipelines.holding = false;
  pipelines.redraw?.();
}

const ignore = () => {};

/** Pipelines compiled at once before booted. Dawn has ~8 threads, and ~9 large ones stalled frames */
const maxCompiling = 4;

/** Materials of what a first map shows, whose pipelines compile before the rest of the scene's */
const firstLookMaterials = new Set([
  "floor",
  "ceiling",
  "walls",
  "obstacles",
  "obstacle-skirts",
  "door-edges",
  "door-fronts",
  "door-backs",
  "decor-sides",
  "decor-tops",
  "decor-shapes",
]);

type DeferOpts = {
  booted: () => boolean;
  /** Asks for a frame, once a pipeline is ready */
  redraw: () => void;
  /** Whether a draw waits until the rest are done */
  later: (renderObject: RenderObject) => boolean;
};

/** The private parts of three's `WebGPURenderer` patched */
type ThreeRenderer = {
  _pipelines: ThreeRendererPipelines;
  backend: {
    device: {
      createPipelineLayout(descriptor: { bindGroupLayouts: unknown[] }): unknown;
      createComputePipelineAsync(descriptor: object): Promise<unknown>;
    };
    get(key: object): any;
    compute(group: unknown, node: unknown, bindings: unknown, pipeline: object, size?: unknown): void;
    pipelineUtils: {
      createComputePipeline(pipeline: { computeProgram: object }, bindings: object[]): void;
    };
  };
};

type ThreeRendererPipelines = {
  deferred?: boolean;
  /** Deferred pipelines still compiling */
  pending: number;
  /** Whilst `true`, a `later` draw is held */
  holding: boolean;
  redraw?: () => void;
  get(renderObject: RenderObject): { pipeline?: unknown };
  getForRender(renderObject: unknown, promises?: null | Promise<void>[]): unknown;
  updateForRender(renderObject: RenderObject): void;
};

/** What is read of three's `RenderObject` */
type RenderObject = { scene: object; material: { name: string } };
