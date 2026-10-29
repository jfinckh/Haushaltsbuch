import { NextResponse, type NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "@/app/_lib/i18n/routing";
import { isSameOriginWrite } from "@/app/_lib/same-origin";

// Picks the language per request and rewrites to the [locale] folder; addresses stay unchanged.
const intl = createMiddleware(routing);

export default function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    // Writes to the API only from the app's own pages (cross-site request forgery).
    const appOrigin = process.env.BETTER_AUTH_URL;
    if (!appOrigin || !isSameOriginWrite(request, appOrigin)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.next();
  }
  return intl(request);
}

export const config = {
  // Everything except Next.js internals and files with an extension (favicon, images).
  matcher: "/((?!_next|_vercel|.*\\..*).*)",
};
