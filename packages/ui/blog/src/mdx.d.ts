// no top-level import/export: `declare module` must stay ambient, not an augmentation
declare module "*.mdx" {
  const MdxContent: (props: { components?: Record<string, React.ComponentType<any>> }) => React.ReactNode;
  export default MdxContent;
  export const title: string | undefined;
  export const order: number | undefined;
}
