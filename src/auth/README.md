# auth

Reusable sign-in, registration and user administration for Next.js apps, built on
[Better Auth](https://better-auth.com) and [daisyUI](https://daisyui.com).

Everything about auth lives in this folder. It imports nothing from the host app
(ESLint enforces that), so it can later move into its own npm package without changes.

## What's in it

| Area | What you get |
| --- | --- |
| Sign-in | Email + password, passkey, OAuth buttons (when providers are configured), "stay signed in" |
| Registration | Open, invite-only or closed; the first user can always register and becomes admin |
| Email | Verification on sign-up, password reset; the host app decides how mail is sent |
| Two-factor | TOTP with QR code, backup codes, "trust this device" |
| Account page | Name, password, 2FA, passkeys, active sessions, delete account |
| Admin | User list with search and paging, create, change role, lock/unlock, sign out everywhere, delete |
| Guards | `requireSession()`, `requireRole()`, `requireAdmin()` for server code; `<SignedIn>`, `<SignedOut>`, `<ShowForRole>` for UI |
| Proxy | Redirects visitors without a session cookie to the sign-in page |
| Texts | German and English, every string overridable |
| Theming | Only daisyUI classes, so the host app's daisyUI theme applies |

## Entry points

Import only from these three files; everything else is internal.

- `@/auth` (`index.ts`): browser-safe. Provider, hooks, components, messages, types.
- `@/auth/server` (`server.ts`): server only. `createAuth`, `createAuthServer`, guards, migrations.
- `@/auth/proxy` (`proxy.ts`): for the Next.js `proxy.ts`.

## Using it in an app

**1. Server setup** (in this app: `src/config/auth.ts`)

```ts
import "server-only";
import { Pool } from "pg";
import { createAuth, createAuthServer } from "@/auth/server";

export const auth = createAuth({
  appName: "My App",
  database: new Pool({ connectionString: process.env.DATABASE_URL }),
  sendEmail: async (email) => {
    // email.kind is "verify-email" or "reset-password"; email.url is the link.
    // Use renderAuthEmail(email, { appName }) for a ready-made text.
  },
  signUp: {
    mode: "invite-only",
    canSignUp: async ({ email, inviteToken }) => isValidInvite(inviteToken, email),
    onSignUp: async (user, { inviteToken }) => acceptInvite(inviteToken, user.id),
  },
  beforeUserDelete: async (user) => deleteAppData(user.id),
});

export const authServer = createAuthServer(auth);
```

Environment: `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET` (see `.env.example`).

**2. API route** `app/api/auth/[...all]/route.ts`

```ts
export const { GET, POST, PATCH, PUT, DELETE } = authServer.handler;
```

**3. Provider** in the root layout

```tsx
<AuthProvider locale="de" features={authServer.features}>{children}</AuthProvider>
```

Optional props: `routes` (if your pages live elsewhere), `messages` (override texts).

**4. Pages** are one line each:

```tsx
export default function Page() {
  return <SignInForm />;
}
```

Components: `SignInForm`, `SignUpForm`, `ForgotPasswordForm`, `ResetPasswordForm`,
`TwoFactorForm`, `AccountSettings` (or its single sections), `UserAdmin`, `UserMenu`.

**5. Protect pages and actions** on the server. With Cache Components the check reads
the request, so it goes in a component inside `<Suspense>`:

```tsx
async function Dashboard() {
  const { user } = await authServer.requireSession();
  // ...
}
```

`requireAdmin()` renders `forbidden.tsx` for non-admins; it needs
`experimental.authInterrupts: true` in `next.config.ts`.
Call the same functions at the top of every server action and route handler.
Client helpers like `<SignedIn>` only hide UI, they don't protect data.

**6. Proxy** `src/proxy.ts`

```ts
export const proxy = createAuthProxy();
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"] };
```

**7. Database tables**: `npm run auth:migrate` creates or updates them (idempotent).

**8. Styles**: the app needs Tailwind 4 with `@plugin "daisyui";`. Once this folder is
an npm package, add `@source "../node_modules/@your-scope/auth";` so Tailwind sees its classes.

## Invites

Invitations belong to the host app (here: households), because what an invite grants
differs per app. The module gives you the hooks: the sign-up form reads `?invite=<token>`
from the URL and sends it as the `x-auth-invite` header; `canSignUp` decides,
`onSignUp` runs after the user exists.

## Moving this into a package later

1. Copy the folder into its own repo, add a `package.json` with `exports` for
   `.`, `./server` and `./proxy`, and peer dependencies on `next`, `react`,
   `better-auth`, `@better-auth/passkey`, `react-qr-code`.
2. Publish to the internal registry (e.g. GitHub Packages).
3. In apps, replace `@/auth` with the package name and add the Tailwind `@source` line.
