import { createContext, useContext } from "react";
import type { useData } from "./hooks/useData";
import type { Registro } from "./types";
export interface AppContextValue extends ReturnType<typeof useData> {
  add: (record?: Registro) => void;
  share: () => void;
  toast: (message: string) => void;
}
export const AppContext = createContext<AppContextValue | null>(null);
export function useDrip() {
  const value = useContext(AppContext);
  if (!value) throw new Error("Drip context required");
  return value;
}
