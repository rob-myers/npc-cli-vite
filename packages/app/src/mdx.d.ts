// no top-level import/export: `declare module` must stay ambient, not an augmentation
declare module "*.mdx" {
  const MdxContent: (props: { components?: Record<string, React.ComponentType<any>> }) => React.ReactNode;
  export default MdxContent;
}
