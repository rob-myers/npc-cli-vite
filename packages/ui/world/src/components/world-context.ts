import type { UseStateRef } from "@npc-cli/util";
import React from "react";

export const WorldContext = React.createContext({} as UseStateRef<import("./World").State>);
