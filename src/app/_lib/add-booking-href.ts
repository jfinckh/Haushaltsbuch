import { safeBack } from "./back-link";

const ACCOUNT_PAGE = /^\/accounts\/([^/]+)$/;
const SHOWN_ON = /^\/(?:transactions|accounts\/[^/]+|statistics(?:\/.*)?)?$/;

/** Pages that are not forms: there the add-booking button covers nothing. */
export function showAddBooking(pathname: string): boolean {
  return SHOWN_ON.test(pathname) && pathname !== "/accounts/new";
}

/**
 * The address of the booking form, opened from the page at `pathname` + `search`: the page's account
 * preselected (not for "all my accounts"), and the page as return address if it is a list page.
 * The form preselects the account only if the caller may see it.
 */
export function addBookingHref(pathname: string, search: string): string {
  const query = new URLSearchParams(search);
  const accountId = pathname.match(ACCOUNT_PAGE)?.[1] ?? query.get("account");
  const params = new URLSearchParams();
  if (accountId && accountId !== "all" && accountId !== "new") params.set("accountId", accountId);
  const back = safeBack(search ? `${pathname}?${query}` : pathname);
  if (back) params.set("back", back);
  const rest = params.toString();
  return rest ? `/transactions/new?${rest}` : "/transactions/new";
}
