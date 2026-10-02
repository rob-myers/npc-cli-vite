import { select } from "three/tsl";
import type * as THREE from "three/webgpu";

/**
 * tsl's `select`, returning the node type named: `selectAs<"vec4">(cond, a, b)`, else an untyped node.
 * Its own overloads union every node type, which is TS2590, "too complex to represent"
 */
export const selectAs = select as <T extends string = never>(
  cond: THREE.Node<"bool">,
  whenTrue: THREE.Node,
  whenFalse: THREE.Node,
) => [T] extends [never] ? THREE.Node : THREE.Node<T>;
