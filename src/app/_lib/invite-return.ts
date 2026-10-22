// Sign-in and sign-up from an invite link lead back to the invite page, where the user accepts. Only
// this fixed path is built from the token, so the parameter can never send anyone elsewhere.

/** Invite tokens are URL-safe base64 (32 random bytes); anything else is ignored. */
const TOKEN = /^[A-Za-z0-9_-]{20,200}$/;

/** The invite token from a query parameter, or null if there is none or it does not look like one. */
export function inviteToken(param: string | string[] | undefined): string | null {
  const value = Array.isArray(param) ? param[0] : param;
  return value && TOKEN.test(value) ? value : null;
}

/** Where to go after signing in or up, and the link to the other form, keeping the invite. */
export function inviteReturn(param: string | string[] | undefined) {
  const token = inviteToken(param);
  const query = token ? `?invite=${token}` : "";
  return {
    redirectTo: token ? `/invite/${token}` : "/",
    signInHref: `/sign-in${query}`,
    signUpHref: `/sign-up${query}`,
  };
}
