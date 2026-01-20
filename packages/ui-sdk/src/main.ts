export * from "./UiContext";
export * from "./ui.store";

export type UiProps = {
  id: string;
};

export type UiInstantiatorDef = {
  inputs: Record<
    string,
    {
      type: "text" | "number" | "checkbox";
      prefix?: string;
    }
  >;
};
