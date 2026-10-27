// The result shape every part's contract uses for calls that can fail in an expected way.

/** A call that did not do what was asked; `reason` says why, for the caller to map to a message or status. */
export type Failure<R extends string> = { ok: false; reason: R };

/** A call that succeeded with the fields of `T` next to `ok: true`, or failed for one of the reasons `R`. */
export type Result<T extends object, R extends string> = ({ ok: true } & T) | Failure<R>;
