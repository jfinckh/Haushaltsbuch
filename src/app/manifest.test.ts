import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import manifest from "./manifest";

const publicDir = fileURLToPath(new URL("../../public", import.meta.url));

describe("manifest", () => {
  it("opens the start page full screen", () => {
    const m = manifest();
    expect(m.start_url).toBe("/");
    expect(m.scope).toBe("/");
    expect(m.display).toBe("standalone");
  });

  it("lists both icon sizes, and their files exist", () => {
    const icons = manifest().icons ?? [];
    expect(icons.map((i) => i.sizes)).toEqual(["192x192", "512x512"]);
    for (const icon of icons) expect(existsSync(publicDir + icon.src)).toBe(true);
  });

  it("has the iPhone home-screen icon", () => {
    expect(existsSync(`${publicDir}/icons/apple-touch-icon.png`)).toBe(true);
  });
});
