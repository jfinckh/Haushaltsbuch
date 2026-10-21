import "server-only";

/** A required environment variable; throws (naming only the variable) if it is missing. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
