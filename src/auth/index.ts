/**
 * Browser-safe entry point of the auth module: provider, hooks, components,
 * messages and shared types. Server helpers live in `./server.ts`.
 */
export { AuthProvider, useAuth, useSession } from "./client/provider";
export type { AuthProviderProps } from "./client/provider";
export { createAppAuthClient } from "./client/create-client";
export type { AppAuthClient } from "./client/create-client";

export { SignInForm } from "./components/sign-in-form";
export { SignUpForm } from "./components/sign-up-form";
export { ForgotPasswordForm, ResetPasswordForm } from "./components/password-reset";
export { TwoFactorForm } from "./components/two-factor-form";
export { UserMenu, SignOutButton, SignedIn, SignedOut, ShowForRole } from "./components/user-menu";
export {
  AccountSettings,
  ProfileSection,
  PasswordSection,
  TwoFactorSection,
  PasskeySection,
  SessionsSection,
  DeleteAccountSection,
} from "./components/account-settings";
export { UserAdmin } from "./components/user-admin";
export { AuthCard, Alert, Field, Section } from "./components/ui";

export { getAuthMessages, errorMessage, format } from "./i18n/messages";
export type { AuthMessages, AuthMessageOverrides } from "./i18n/messages";
export { hasRole } from "./core/roles";
export { safeRedirectPath } from "./core/redirect";
export * from "./core/types";
