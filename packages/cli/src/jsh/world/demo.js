/**
 * @param {JshCli.RunArg} ct
 */
export function demo_add_colliders(ct) {
  ct.w.e.addColliders(
    {
      colliderKey: "test-decor-circle",
      type: "circle",
      x: 2.5,
      y: 2.5,
      radius: 1.5,
    },
    {
      colliderKey: "test-decor-rect",
      type: "rect",
      x: 3,
      y: 7.5,
      width: 2 * 1.5,
      height: 1 * 1.5,
    },
  );
}

/**
 * @param {JshCli.RunArg} ct
 */
export function demo_add_decor(ct) {
  const _decorCircle = ct.w.decor.create({
    type: "circle",
    key: "test-decor-circle",
    center: { x: 2.5, y: 2.5 },
    radius: 1.5,
    meta: { shown: true, collider: true },
  });

  const _decorPoint = ct.w.decor.create({
    type: "point",
    key: "test-decor-point",
    x: 4.5,
    y: 7.5,
    img: "icon--warn",
    orient: 0,
    y3d: 0.01,
    meta: { shown: true, collider: true },
  });

  const _decorRect = ct.w.decor.create({
    type: "rect",
    key: "test-decor-rect",
    x: 3,
    y: 7.5,
    width: 2 * 1.5,
    height: 1 * 1.5,
    meta: { foo: "bar", shown: true, collider: true },
  });

  ct.w.view.forceUpdate();
}
