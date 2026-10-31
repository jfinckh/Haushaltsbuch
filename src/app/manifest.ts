import type { MetadataRoute } from "next";

// App description for "add to home screen" (served as /manifest.webmanifest). The name is the
// product name, like the page title, so it is not translated. Colours: light theme (globals.css).
// Cloudflare Access lets this file and /icons/* through without login (infra/cloudflare.tf),
// because browsers load the manifest without cookies.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Haushaltsbuch",
    short_name: "Haushaltsbuch",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fdfcfa",
    theme_color: "#fdfcfa",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
