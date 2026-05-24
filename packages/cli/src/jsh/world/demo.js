/**
 * @param {JshCli.RunArg} ct
 */
export function demo_add_decor(ct) {
  const _decorCircle = ct.w.decor.create({
    type: "circle",
    key: "test-decor-circle",
    center: { x: 2.5, y: 2.5 },
    radius: 1.5,
  });

  const _decorPoint = ct.w.decor.create({
    type: "point",
    key: "test-decor-point",
    x: 3,
    y: 7.5,
    img: "icon--warn",
    orient: 0,
    y3d: 0.01,
  });

  const _decorRect = ct.w.decor.create({
    type: "rect",
    key: "test-decor-rect",
    x: 3,
    y: 7.5,
    width: 2 * 1.5,
    height: 1 * 1.5,
    meta: { foo: "bar" },
  });
}
