"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import QRCode from "react-qr-code";
import { useAuth, useSession } from "../client/provider";
import { format } from "../i18n/messages";
import { Alert, Field, Section, SubmitButton, useAuthAction, useAuthQuery } from "./ui";

function useDateFormat() {
  const { locale } = useAuth();
  const fmt = new Intl.DateTimeFormat(locale === "de" ? "de-DE" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return (value: Date | string) => fmt.format(new Date(value));
}

export function ProfileSection() {
  const { client, messages: m } = useAuth();
  const { data, refetch } = useSession();
  const { run, pending, error } = useAuthAction();
  const [saved, setSaved] = useState(false);
  if (!data) return null;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaved(false);
    const name = String(new FormData(e.currentTarget).get("name"));
    const result = await run(() => client.updateUser({ name }));
    if (result && !result.error) {
      setSaved(true);
      refetch();
    }
  }

  return (
    <Section title={m.account.profile.title}>
      {error && <Alert>{error}</Alert>}
      {saved && <Alert kind="success">{m.common.saved}</Alert>}
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <Field label={m.common.name} name="name" defaultValue={data.user.name} required />
        <Field
          label={m.common.email}
          value={data.user.email}
          readOnly
          disabled
          hint={m.account.profile.emailHint}
        />
        <SubmitButton pending={pending} className="btn-primary self-start">
          {m.common.save}
        </SubmitButton>
      </form>
    </Section>
  );
}

export function PasswordSection() {
  const { client, messages: m } = useAuth();
  const { run, pending, error } = useAuthAction();
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setDone(false);
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    const result = await run(() =>
      client.changePassword({
        currentPassword: String(form.get("currentPassword")),
        newPassword: String(form.get("newPassword")),
        revokeOtherSessions: form.get("revokeOthers") === "on",
      }),
    );
    if (result && !result.error) {
      setDone(true);
      formEl.reset();
    }
  }

  return (
    <Section title={m.account.password.title}>
      {error && <Alert>{error}</Alert>}
      {done && <Alert kind="success">{m.account.password.success}</Alert>}
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <Field
          label={m.account.password.current}
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
        />
        <Field
          label={m.account.password.new}
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="revokeOthers" className="checkbox checkbox-sm" defaultChecked />
          {m.account.password.revokeOthers}
        </label>
        <SubmitButton pending={pending} className="btn-primary self-start">
          {m.account.password.submit}
        </SubmitButton>
      </form>
    </Section>
  );
}

type TwoFactorStep =
  | { step: "idle" }
  | { step: "password"; action: "enable" | "disable" }
  | { step: "scan"; totpURI: string; backupCodes: string[] }
  | { step: "backup"; backupCodes: string[] };

export function TwoFactorSection() {
  const { client, messages: m } = useAuth();
  const { data, refetch } = useSession();
  const { run, pending, error } = useAuthAction();
  const [state, setState] = useState<TwoFactorStep>({ step: "idle" });
  if (!data) return null;
  const enabled = Boolean(data.user.twoFactorEnabled);
  const t = m.account.twoFactor;

  async function onPassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state.step !== "password") return;
    const password = String(new FormData(e.currentTarget).get("password"));
    if (state.action === "disable") {
      const result = await run(() => client.twoFactor.disable({ password }));
      if (result && !result.error) {
        setState({ step: "idle" });
        refetch();
      }
      return;
    }
    const result = await run(() => client.twoFactor.enable({ password }));
    if (result?.data && "totpURI" in result.data) {
      setState({ step: "scan", totpURI: result.data.totpURI, backupCodes: result.data.backupCodes });
    }
  }

  async function onVerify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state.step !== "scan") return;
    const code = String(new FormData(e.currentTarget).get("code")).replace(/\s/g, "");
    const result = await run(() => client.twoFactor.verifyTotp({ code }));
    if (result && !result.error) {
      setState({ step: "backup", backupCodes: state.backupCodes });
      refetch();
    }
  }

  const secret = state.step === "scan" ? new URL(state.totpURI).searchParams.get("secret") : null;

  return (
    <Section title={t.title}>
      {error && <Alert>{error}</Alert>}
      {state.step === "idle" && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">{enabled ? t.enabled : t.disabled}</p>
          <button
            type="button"
            className={`btn btn-sm ${enabled ? "btn-outline" : "btn-primary"}`}
            onClick={() => setState({ step: "password", action: enabled ? "disable" : "enable" })}
          >
            {enabled ? t.disable : t.enable}
          </button>
        </div>
      )}
      {state.step === "password" && (
        <form onSubmit={onPassword} className="flex flex-col gap-3">
          <Field label={t.passwordPrompt} name="password" type="password" autoComplete="current-password" required autoFocus />
          <div className="flex gap-2">
            <SubmitButton pending={pending}>{state.action === "enable" ? t.enable : t.disable}</SubmitButton>
            <button type="button" className="btn btn-ghost" onClick={() => setState({ step: "idle" })}>
              {m.common.cancel}
            </button>
          </div>
        </form>
      )}
      {state.step === "scan" && (
        <form onSubmit={onVerify} className="flex flex-col gap-3">
          <p className="text-sm">{t.scan}</p>
          <div className="bg-white p-3 self-start rounded-box">
            <QRCode value={state.totpURI} size={160} />
          </div>
          {secret && (
            <p className="text-xs">
              {t.manualKey}: <code className="font-mono break-all">{secret}</code>
            </p>
          )}
          <Field label={m.twoFactor.code} name="code" inputMode="numeric" autoComplete="one-time-code" required />
          <SubmitButton pending={pending} className="btn-primary self-start">
            {t.verify}
          </SubmitButton>
        </form>
      )}
      {state.step === "backup" && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium">{t.backupCodes}</p>
          <p className="text-sm">{t.backupCodesHint}</p>
          <ul className="grid grid-cols-2 gap-1 font-mono text-sm bg-base-200 rounded-box p-3">
            {state.backupCodes.map((code) => (
              <li key={code}>{code}</li>
            ))}
          </ul>
          <button type="button" className="btn btn-primary self-start" onClick={() => setState({ step: "idle" })}>
            {t.done}
          </button>
        </div>
      )}
    </Section>
  );
}

interface PasskeyRow {
  id: string;
  name?: string | null;
  createdAt: Date | string;
}

export function PasskeySection() {
  const { client, messages: m } = useAuth();
  const formatDate = useDateFormat();
  const { run, pending, error } = useAuthAction();
  const query = useAuthQuery<PasskeyRow[]>("passkeys", () => client.passkey.listUserPasskeys());
  const passkeys = query.data === undefined ? null : (query.data ?? []);
  const load = query.reload;
  const t = m.account.passkeys;

  async function onAdd() {
    const name = window.prompt(t.namePrompt) ?? undefined;
    const result = await run(() => client.passkey.addPasskey({ name }));
    if (result && !result.error) load();
  }

  async function onDelete(id: string) {
    const result = await run(() => client.passkey.deletePasskey({ id }));
    if (result && !result.error) load();
  }

  return (
    <Section title={t.title}>
      <p className="text-sm">{t.intro}</p>
      {(error ?? query.error) && <Alert>{error ?? query.error}</Alert>}
      {passkeys === null ? (
        <span className="loading loading-spinner loading-sm" />
      ) : passkeys.length === 0 ? (
        <p className="text-sm text-base-content/60">{t.none}</p>
      ) : (
        <ul className="list bg-base-100">
          {passkeys.map((p) => (
            <li key={p.id} className="list-row items-center">
              <div className="list-col-grow">
                <div>{p.name || "Passkey"}</div>
                <div className="text-xs text-base-content/60">
                  {format(t.createdAt, { date: formatDate(p.createdAt) })}
                </div>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDelete(p.id)}>
                {m.common.delete}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn btn-outline btn-sm self-start" onClick={onAdd} disabled={pending}>
        {t.add}
      </button>
    </Section>
  );
}

interface SessionRow {
  id: string;
  token: string;
  userAgent?: string | null;
  createdAt: Date | string;
}

function describeAgent(ua: string | null | undefined, fallback: string) {
  if (!ua) return fallback;
  const browser = /Firefox|Edg|Chrome|Safari/.exec(ua)?.[0]?.replace("Edg", "Edge");
  const os = /Windows|Mac OS X|Android|iPhone|iPad|Linux/.exec(ua)?.[0]?.replace("Mac OS X", "macOS");
  return [browser, os].filter(Boolean).join(" · ") || fallback;
}

export function SessionsSection() {
  const { client, messages: m } = useAuth();
  const { data } = useSession();
  const formatDate = useDateFormat();
  const { run, error } = useAuthAction();
  const query = useAuthQuery<SessionRow[]>("sessions", () => client.listSessions());
  const sessions = query.data === undefined ? null : (query.data ?? []);
  const load = query.reload;
  const t = m.account.sessions;
  const currentToken = data?.session.token;

  async function revoke(token: string) {
    const result = await run(() => client.revokeSession({ token }));
    if (result && !result.error) load();
  }

  async function revokeOthers() {
    const result = await run(() => client.revokeOtherSessions());
    if (result && !result.error) load();
  }

  return (
    <Section title={t.title}>
      {(error ?? query.error) && <Alert>{error ?? query.error}</Alert>}
      {sessions === null ? (
        <span className="loading loading-spinner loading-sm" />
      ) : (
        <ul className="list">
          {sessions.map((s) => (
            <li key={s.id} className="list-row items-center">
              <div className="list-col-grow">
                <div>
                  {describeAgent(s.userAgent, t.unknownDevice)}
                  {s.token === currentToken && (
                    <span className="badge badge-sm badge-primary ml-2">{t.current}</span>
                  )}
                </div>
                <div className="text-xs text-base-content/60">
                  {format(t.lastActive, { date: formatDate(s.createdAt) })}
                </div>
              </div>
              {s.token !== currentToken && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => revoke(s.token)}>
                  {t.revoke}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {sessions && sessions.length > 1 && (
        <button type="button" className="btn btn-outline btn-sm self-start" onClick={revokeOthers}>
          {t.revokeOthers}
        </button>
      )}
    </Section>
  );
}

export function DeleteAccountSection() {
  const { client, routes, messages: m } = useAuth();
  const router = useRouter();
  const { run, pending, error } = useAuthAction();
  const t = m.account.deleteAccount;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get("password"));
    const result = await run(() => client.deleteUser({ password }));
    if (result && !result.error) {
      router.push(routes.afterSignOut);
      router.refresh();
    }
  }

  return (
    <Section title={t.title}>
      <p className="text-sm">{t.intro}</p>
      {error && <Alert>{error}</Alert>}
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <Field label={t.confirm} name="password" type="password" autoComplete="current-password" required />
        <SubmitButton pending={pending} className="btn-error self-start">
          {t.submit}
        </SubmitButton>
      </form>
    </Section>
  );
}

/** All account sections in one page. Use the sections on their own to build a custom layout. */
export function AccountSettings() {
  const { features, messages: m } = useAuth();
  const { data, isPending } = useSession();
  if (isPending) return <span className="loading loading-spinner" />;
  if (!data) return <Alert kind="info">{m.guard.signInRequired}</Alert>;

  return (
    <div className="flex flex-col gap-4 w-full max-w-2xl">
      <h1 className="text-2xl font-semibold">{m.account.title}</h1>
      <ProfileSection />
      <PasswordSection />
      {features.twoFactor && <TwoFactorSection />}
      {features.passkey && <PasskeySection />}
      <SessionsSection />
      {features.deleteAccount && <DeleteAccountSection />}
    </div>
  );
}
