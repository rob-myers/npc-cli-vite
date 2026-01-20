export * from "./UiContext";
export * from "./ui.store";

export type UiProps = {
  id: string;
};

export type UiBootstrapProps = {
  addInstance(): void;
};
