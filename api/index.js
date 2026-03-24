import "dotenv/config";

/**
 * Vercel runs Express by importing the app directly (do not use serverless-http here —
 * it can break req.url so routes like POST /admin/login never match).
 * @see https://vercel.com/kb/guide/using-express-with-vercel
 */
import app from "../src/app.js";

export default app;
