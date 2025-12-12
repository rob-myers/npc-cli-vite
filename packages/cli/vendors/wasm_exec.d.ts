declare global {
  class Go {
    importObject: WebAssembly.Imports;
    argv: string[];
    env: { [key: string]: string };
    exit(code: number): void;
    run(instance: WebAssembly.Instance): Promise<void>;
  }
  interface Window {
    Go: typeof Go;
  }
}

export {};
