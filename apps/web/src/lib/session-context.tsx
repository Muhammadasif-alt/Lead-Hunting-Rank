"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Me } from "./me";

const SessionContext = createContext<Me | null>(null);

export function SessionProvider({ me, children }: { me: Me; children: ReactNode }) {
  return <SessionContext.Provider value={me}>{children}</SessionContext.Provider>;
}

/** The signed-in user inside the app shell. */
export function useMe(): Me {
  const me = useContext(SessionContext);
  if (!me) throw new Error("useMe() must be used inside the app shell");
  return me;
}
