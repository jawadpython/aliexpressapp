import crypto from "crypto";
import cookieSession from "cookie-session";

function hashPassword(s) {
  return crypto.createHash("sha256").update(String(s), "utf8").digest();
}

function timingSafeEqualPassword(input, expectedPlain) {
  const a = hashPassword(input);
  const b = hashPassword(expectedPlain);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function isProduction() {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL === "1"
  );
}

/**
 * Cookie-based session (works on Vercel serverless; no server-side memory store).
 */
export function createSessionMiddleware() {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) {
    console.warn(
      "SESSION_SECRET is not set — using insecure dev default. Set SESSION_SECRET in production."
    );
  }
  const key = secret || "dev-only-insecure-change-me";
  return cookieSession({
    name: "admin.sid",
    keys: [key],
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
  });
}

export function requireAdmin(req, res, next) {
  const pass = process.env.ADMIN_PASSWORD?.trim();
  if (!pass) {
    return res.status(503).json({
      error: "Admin disabled: set ADMIN_PASSWORD in .env",
    });
  }
  if (req.session?.admin !== true) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

const DEFAULT_USER = "admin";

export function postAdminLogin(req, res) {
  const pass = process.env.ADMIN_PASSWORD?.trim();
  if (!pass) {
    return res.status(503).json({ error: "ADMIN_PASSWORD not configured" });
  }

  const user = String(req.body?.username ?? "").trim();
  const password = String(req.body?.password ?? "");
  const expectedUser = (process.env.ADMIN_USERNAME || DEFAULT_USER).trim();

  if (user !== expectedUser || !timingSafeEqualPassword(password, pass)) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  req.session.admin = true;
  return res.json({ ok: true });
}

export function postAdminLogout(req, res) {
  req.session = null;
  return res.json({ ok: true });
}

export function getAdminSession(req, res) {
  res.json({ loggedIn: req.session?.admin === true });
}
