/**
 * Until `booted()`, a draw or compute needing a new pipeline has Dawn create it off the GPU's frame thread,
 * and is skipped until it is ready. three creates them synchronously, which on a cold GPU stops frames for each.
 */
export function deferPipelines(renderer: unknown, booted: () => boolean, redraw: () => void): void {
  const { _pipelines: pipelines, backend } = renderer as ThreeRenderer;
  if (pipelines.deferred === true) return;
  pipelines.deferred = true;

  pipelines.updateForRender = (renderObject) => {
    const promises: Promise<void>[] = [];
    pipelines.getForRender(renderObject, booted() ? null : promises);
    promises.length > 0 && void Promise.all(promises).then(redraw, ignore);
  };

  // three has no async compute pipeline, so this is its own, made async
  const { pipelineUtils, device } = backend;
  const createCompute = pipelineUtils.createComputePipeline.bind(pipelineUtils);
  pipelineUtils.createComputePipeline = (pipeline, bindings) => {
    if (booted()) return createCompute(pipeline, bindings);
    const bindGroupLayouts = bindings.map((group) => backend.get(group).layout.layoutGPU);
    const layout = device.createPipelineLayout({ bindGroupLayouts });
    void device
      .createComputePipelineAsync({ compute: backend.get(pipeline.computeProgram).module, layout })
      .then((gpu) => {
        backend.get(pipeline).pipeline = gpu;
        redraw();
      }, ignore);
  };

  const compute = backend.compute.bind(backend);
  /** A dispatch whose pipeline is still compiling is skipped */
  backend.compute = (group, node, bindings, pipeline, size) =>
    backend.get(pipeline).pipeline === undefined ? undefined : compute(group, node, bindings, pipeline, size);
}

const ignore = () => {};

/** The private parts of three's `WebGPURenderer` patched */
interface ThreeRenderer {
  _pipelines: {
    deferred?: boolean;
    getForRender(renderObject: unknown, promises?: null | Promise<void>[]): unknown;
    updateForRender(renderObject: unknown): void;
  };
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
}
