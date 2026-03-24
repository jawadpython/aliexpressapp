/**
 * Load and normalize .env strings (common copy/paste issues break Taobao signing).
 */
export function trimEnv(name) {
  let v = process.env[name];
  if (v == null) return undefined;
  v = String(v).trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }
  return v || undefined;
}
