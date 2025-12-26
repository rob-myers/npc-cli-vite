export default function jsFunctionToShellFunction(opts: {
  modules: Record<string, any>;
  moduleKey: string;
  fnKey: string;
  fnAliasKey?: string;
  fn(...args: any[]): any,
}) {

  const module = opts.modules[opts.moduleKey] as ModuleMaybeMeta;

  return `${opts.fnAliasKey ?? opts.fnKey}() ${
    generatorConstructorNames.includes(opts.fn.constructor.name)
      // function* foo { bar }
      // async function* foo { bar }
      ? `{\n  run ${opts.moduleKey} ${opts.fnKey} "$@"\n}`
      /**
       * A non-generator JS function should be `map`d
       * if `module.meta` exists and it is listed.
       *
       * 🔔 SWC sometimes transpiles arrow functions to functions,
       *  so we can't distinguish based on arrow functions vs functions.
       */
      : isMapFunc(module, opts.fn)
        ? `{\n  map ${opts.moduleKey} ${opts.fnKey} "$@"\n}`
        : `{\n  run ${opts.moduleKey} ${opts.fnKey} "$@"\n}`
  }`;
}

const generatorConstructorNames = [
  'AsyncGeneratorFunction',
  'GeneratorFunction',
];

export type ModuleMaybeMeta = { meta?: { map: Meta } };

// check value since name can be different in build
function isMapFunc(module: ModuleMaybeMeta, fn: (...args: any[]) => any) {
  return Object.values(module.meta?.map ?? {}).some(x => x === fn);
}
