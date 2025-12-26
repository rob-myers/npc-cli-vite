declare type Pretty<T> = T extends unknown ? { [K in keyof T]: T[K] } : never;

type Meta<T extends {} = {}> = Record<string, any> & T;

type MaybeMeta<T, U extends Record<string, any> = Record<string, any>> = T & { meta?: Meta<U> };

type WithMeta<T, U extends Record<string, any> = Record<string, any>> = T & { meta: Meta<U> };

/**
 * Converts the given string from camel-case to kebab-case.
 * @template T The string to convert the case.
 * @see https://gist.github.com/albertms10/09f14ef7ebdc3ce0e95683c728616253
 * @example
 * type Kebab = CamelToKebab<'exampleVarName'>;
 * // 'example-var-name'
 */
type CamelToKebab<S extends string> = S extends `${infer T}${infer U}`
  ? U extends Uncapitalize<U>
    ? `${Uncapitalize<T>}${CamelToKebab<U>}`
    : `${Uncapitalize<T>}-${CamelToKebab<U>}`
  : "";

/**
 * https://stackoverflow.com/q/59368321/2917822
 */
type ClassSansMethods<T> = Pick<
  T,
  {
    [Key in keyof T]: T[Key] extends (..._: any) => any ? never : Key;
  }[keyof T]
>;

/**
 * node_modules/@emotion/react/dist/declarations/src/types.d.ts
 */
type DistributiveOmit<T, U> = T extends any ? Pick<T, Exclude<keyof T, U>> : never;
