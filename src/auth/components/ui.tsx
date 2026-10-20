"use client";

import { useEffect, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { useAuth } from "../client/provider";
import { errorMessage } from "../i18n/messages";

/** Centered card used by all auth pages. */
export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="card bg-base-100 shadow-md w-full max-w-sm mx-auto">
      <div className="card-body gap-4">
        <h1 className="card-title text-2xl">{title}</h1>
        {children}
      </div>
    </div>
  );
}

/** A settings section in a bordered card. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card card-border bg-base-100">
      <div className="card-body gap-3">
        <h2 className="card-title text-lg">{title}</h2>
        {children}
      </div>
    </section>
  );
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
}

export function Field({ label, hint, className, ...input }: FieldProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      <input className={`input w-full ${className ?? ""}`} {...input} />
      {hint && <span className="text-xs text-base-content/60">{hint}</span>}
    </label>
  );
}

export function Alert({
  kind = "error",
  children,
}: {
  kind?: "error" | "success" | "info" | "warning";
  children: ReactNode;
}) {
  const cls = {
    error: "alert-error",
    success: "alert-success",
    info: "alert-info",
    warning: "alert-warning",
  }[kind];
  return (
    <div role={kind === "error" ? "alert" : "status"} className={`alert alert-soft ${cls}`}>
      <span>{children}</span>
    </div>
  );
}

export function SubmitButton({
  pending,
  children,
  className = "btn-primary",
}: {
  pending: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button type="submit" className={`btn ${className}`} disabled={pending}>
      {pending && <span className="loading loading-spinner loading-sm" />}
      {children}
    </button>
  );
}

type ApiError = { code?: string; status?: number; message?: string } | null | undefined;
type ApiResult = { error?: ApiError } | undefined | void;

/**
 * Runs a better-auth client call and tracks pending and error state.
 * The callback returns the client result; `{ error }` becomes a message.
 */
export function useAuthAction() {
  const { messages } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  async function run<T extends ApiResult>(fn: () => Promise<T>): Promise<T | undefined> {
    setPending(true);
    setError(null);
    setErrorCode(null);
    try {
      const result = await fn();
      if (result && result.error) {
        setError(errorMessage(messages, result.error));
        setErrorCode(result.error.code ?? result.error.message ?? null);
      }
      return result;
    } catch (e) {
      setError(errorMessage(messages, e as ApiError));
      return undefined;
    } finally {
      setPending(false);
    }
  }

  return { run, pending, error, errorCode, setError };
}

/**
 * Loads data with a better-auth client call. Re-runs when `key` changes or
 * `reload()` is called. `data` is undefined while the first load runs.
 */
export function useAuthQuery<T>(
  key: string,
  fetcher: () => Promise<{ data: T | null; error?: ApiError }>,
) {
  const { messages } = useAuth();
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<{ data?: T | null; error: string | null }>({ error: null });

  useEffect(() => {
    let active = true;
    fetcher().then(
      (result) => {
        if (!active) return;
        setState({
          data: result.data,
          error: result.error ? errorMessage(messages, result.error) : null,
        });
      },
      (e: ApiError) => active && setState({ data: null, error: errorMessage(messages, e) }),
    );
    return () => {
      active = false;
    };
    // `fetcher` is a new closure every render; `key` names what it depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version, messages]);

  return { ...state, reload: () => setVersion((v) => v + 1) };
}
