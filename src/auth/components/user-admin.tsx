"use client";

import { useRef, useState } from "react";
import { useAuth, useSession } from "../client/provider";
import { hasRole } from "../core/roles";
import { ADMIN_ROLE, USER_ROLE } from "../core/types";
import { format } from "../i18n/messages";
import { Alert, Field, SubmitButton, useAuthAction, useAuthQuery } from "./ui";

interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  role?: string | null;
  banned?: boolean | null;
  emailVerified: boolean;
  createdAt: Date | string;
}

const PAGE_SIZE = 20;

/**
 * User administration for admins: search, create, change role, lock,
 * sign out everywhere and delete. The server checks the admin role on
 * every call, so this component is safe to render for anyone.
 */
export function UserAdmin({ roles = [USER_ROLE, ADMIN_ROLE] }: { roles?: string[] }) {
  const { client, locale, messages: m } = useAuth();
  const { data: session } = useSession();
  const { run, pending, error } = useAuthAction();
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const t = m.admin;
  const dateFmt = new Intl.DateTimeFormat(locale === "de" ? "de-DE" : "en-GB", { dateStyle: "medium" });
  const roleLabel = (role: string) => (t.roles as Record<string, string>)[role] ?? role;

  const query = useAuthQuery(`users:${offset}:${search}`, () =>
    client.admin.listUsers({
      query: {
        limit: PAGE_SIZE,
        offset,
        sortBy: "createdAt",
        sortDirection: "desc",
        ...(search ? { searchValue: search, searchField: "email", searchOperator: "contains" } : {}),
      },
    }),
  );
  const users = query.data ? (query.data.users as AdminUserRow[]) : query.data === null ? [] : null;
  const total = query.data?.total ?? 0;
  const load = query.reload;

  async function act(fn: () => Promise<{ error?: unknown } | undefined | void>) {
    const result = await run(fn as () => Promise<{ error?: { code?: string } | null }>);
    if (result && !result.error) load();
  }

  async function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    const result = await run(() =>
      client.admin.createUser({
        name: String(form.get("name")),
        email: String(form.get("email")),
        password: String(form.get("password")),
        role: String(form.get("role")) as "user" | "admin",
        // Admins add people they know; without this they'd need a mail server to get in.
        data: { emailVerified: form.get("emailVerified") === "on" },
      }),
    );
    if (result && !result.error) {
      formEl.reset();
      dialog.current?.close();
      load();
    }
  }

  return (
    <div className="flex flex-col gap-4 w-full">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold grow">{t.title}</h1>
        <input
          type="search"
          className="input input-sm w-60"
          placeholder={t.search}
          value={search}
          onChange={(e) => {
            setOffset(0);
            setSearch(e.target.value);
          }}
        />
        <button type="button" className="btn btn-primary btn-sm" onClick={() => dialog.current?.showModal()}>
          {t.create}
        </button>
      </div>

      {(error ?? query.error) && <Alert>{error ?? query.error}</Alert>}

      <div className="overflow-x-auto rounded-box border border-base-300 bg-base-100">
        <table className="table">
          <thead>
            <tr>
              <th>{m.common.name}</th>
              <th>{t.role}</th>
              <th>{t.status}</th>
              <th>{t.created}</th>
              <th className="text-right">{t.actions}</th>
            </tr>
          </thead>
          <tbody>
            {users === null && (
              <tr>
                <td colSpan={5}>
                  <span className="loading loading-spinner loading-sm" />
                </td>
              </tr>
            )}
            {users?.length === 0 && (
              <tr>
                <td colSpan={5} className="text-base-content/60">
                  {t.empty}
                </td>
              </tr>
            )}
            {users?.map((u) => {
              const isSelf = u.id === session?.user.id;
              const currentRole = roles.find((r) => hasRole(u, r)) ?? USER_ROLE;
              return (
                <tr key={u.id}>
                  <td>
                    <div className="font-medium">
                      {u.name} {isSelf && <span className="text-base-content/60">({t.you})</span>}
                    </div>
                    <div className="text-xs text-base-content/60">{u.email}</div>
                  </td>
                  <td>
                    <select
                      className="select select-sm"
                      value={currentRole}
                      disabled={isSelf || pending}
                      onChange={(e) =>
                        act(() =>
                          client.admin.setRole({ userId: u.id, role: e.target.value as "user" | "admin" }),
                        )
                      }
                    >
                      {roles.map((r) => (
                        <option key={r} value={r}>
                          {roleLabel(r)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="space-x-1">
                    {u.banned ? (
                      <span className="badge badge-error badge-sm">{t.banned}</span>
                    ) : (
                      <span className="badge badge-success badge-sm">{t.active}</span>
                    )}
                    {!u.emailVerified && <span className="badge badge-warning badge-sm">{t.unverified}</span>}
                  </td>
                  <td>{dateFmt.format(new Date(u.createdAt))}</td>
                  <td className="text-right">
                    {!isSelf && (
                      <div className="dropdown dropdown-end">
                        <div tabIndex={0} role="button" className="btn btn-ghost btn-sm">
                          …
                        </div>
                        <ul tabIndex={0} className="menu dropdown-content bg-base-100 rounded-box z-10 w-52 p-2 shadow">
                          <li>
                            {u.banned ? (
                              <button type="button" onClick={() => act(() => client.admin.unbanUser({ userId: u.id }))}>
                                {t.unban}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  const banReason = window.prompt(t.banReason) ?? undefined;
                                  act(() => client.admin.banUser({ userId: u.id, banReason }));
                                }}
                              >
                                {t.ban}
                              </button>
                            )}
                          </li>
                          <li>
                            <button
                              type="button"
                              onClick={() => act(() => client.admin.revokeUserSessions({ userId: u.id }))}
                            >
                              {t.revokeSessions}
                            </button>
                          </li>
                          <li>
                            <button
                              type="button"
                              className="text-error"
                              onClick={() => {
                                if (window.confirm(format(t.confirmRemove, { email: u.email }))) {
                                  act(() => client.admin.removeUser({ userId: u.id }));
                                }
                              }}
                            >
                              {t.remove}
                            </button>
                          </li>
                        </ul>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-end gap-3 text-sm">
          <span>
            {format(t.pageInfo, {
              from: offset + 1,
              to: Math.min(offset + PAGE_SIZE, total),
              total,
            })}
          </span>
          <div className="join">
            <button
              type="button"
              className="join-item btn btn-sm"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              {t.previous}
            </button>
            <button
              type="button"
              className="join-item btn btn-sm"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              {t.next}
            </button>
          </div>
        </div>
      )}

      <dialog ref={dialog} className="modal">
        <div className="modal-box">
          <h3 className="text-lg font-semibold mb-3">{t.createTitle}</h3>
          <form onSubmit={onCreate} className="flex flex-col gap-3">
            <Field label={m.common.name} name="name" required />
            <Field label={m.common.email} name="email" type="email" required />
            <Field label={m.common.password} name="password" type="password" autoComplete="new-password" required />
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">{t.role}</span>
              <select name="role" className="select w-full" defaultValue={USER_ROLE}>
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel(r)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="emailVerified" className="checkbox checkbox-sm" defaultChecked />
              {t.markVerified}
            </label>
            <div className="modal-action">
              <button type="button" className="btn btn-ghost" onClick={() => dialog.current?.close()}>
                {m.common.cancel}
              </button>
              <SubmitButton pending={pending}>{t.create}</SubmitButton>
            </div>
          </form>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button type="submit">{m.common.cancel}</button>
        </form>
      </dialog>
    </div>
  );
}
