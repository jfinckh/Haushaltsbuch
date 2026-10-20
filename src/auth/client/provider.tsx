"use client";

import { createContext, use, useMemo, useState, type ReactNode } from "react";
import {
  defaultAuthFeatures,
  defaultAuthRoutes,
  type AuthFeatures,
  type AuthLocale,
  type AuthRoutes,
} from "../core/types";
import { getAuthMessages, type AuthMessageOverrides, type AuthMessages } from "../i18n/messages";
import { createAppAuthClient, type AppAuthClient } from "./create-client";

interface AuthContextValue {
  client: AppAuthClient;
  routes: AuthRoutes;
  features: AuthFeatures;
  messages: AuthMessages;
  locale: AuthLocale;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export interface AuthProviderProps {
  children: ReactNode;
  /** Defaults to the current origin. */
  baseURL?: string;
  locale?: AuthLocale;
  routes?: Partial<AuthRoutes>;
  /** Pass `authServer.features` from the server so UI and server agree. */
  features?: Partial<AuthFeatures>;
  messages?: AuthMessageOverrides;
  /** Bring your own client, e.g. one shared with non-React code. */
  client?: AppAuthClient;
}

export function AuthProvider({
  children,
  baseURL,
  locale = "de",
  routes,
  features,
  messages,
  client,
}: AuthProviderProps) {
  const [ownClient] = useState(() => client ?? createAppAuthClient({ baseURL }));
  const value = useMemo<AuthContextValue>(
    () => ({
      client: ownClient,
      routes: { ...defaultAuthRoutes, ...routes },
      features: { ...defaultAuthFeatures, ...features },
      messages: getAuthMessages(locale, messages),
      locale,
    }),
    [ownClient, routes, features, messages, locale],
  );
  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth() {
  const ctx = use(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** The current session on the client. `data` is null when signed out. */
export function useSession() {
  return useAuth().client.useSession();
}
