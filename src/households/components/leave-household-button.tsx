"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type Props = {
  /** Whether the user is the only member, so leaving deletes the household. */
  lastMember: boolean;
  /** What else happens when the user leaves, from the app (e.g. what happens to other parts' data). */
  note?: string;
  /** Endpoint for the caller's membership. Default: /api/households/membership */
  action?: string;
  /** Where to go after leaving. Default: /household/new */
  redirectTo?: string;
};

/** Leaves the household after a confirmation. The last member to leave deletes it. */
export function LeaveHouseholdButton({
  lastMember,
  note,
  action = "/api/households/membership",
  redirectTo = "/household/new",
}: Props) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function leave() {
    setPending(true);
    setError(null);
    const response = await fetch(action, { method: "DELETE" });
    setPending(false);
    if (!response.ok && response.status !== 404) return setError("Could not leave the household. Please try again.");
    dialog.current?.close();
    router.push(redirectTo);
    router.refresh();
  }

  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm text-error" onClick={() => dialog.current?.showModal()}>
        Leave household
      </button>
      <dialog ref={dialog} className="modal">
        <div className="modal-box">
          <h3 className="text-lg font-bold">Leave this household?</h3>
          <p className="py-4">
            {lastMember
              ? "You are the only member. Leaving deletes the household. Afterwards you can create a new one or join another one through a new invite link."
              : "The other members keep the household. Afterwards you can create a new one or join another one through a new invite link."}
          </p>
          {note && <p className="pb-4">{note}</p>}
          {error && <p className="text-error">{error}</p>}
          <div className="modal-action">
            <form method="dialog">
              <button className="btn">Cancel</button>
            </form>
            <button type="button" className="btn btn-error" onClick={leave} disabled={pending}>
              {pending && <span className="loading loading-spinner loading-sm" />}
              Leave
            </button>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>
    </>
  );
}
