import createMiddleware from "next-intl/middleware";
import { routing } from "@/app/_lib/i18n/routing";

// Picks the language per request and rewrites to the [locale] folder; addresses stay unchanged.
export default createMiddleware(routing);

export const config = {
  // Everything except the API, Next.js internals and files with an extension (favicon, images).
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
