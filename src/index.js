import "dotenv/config";
import app from "./app.js";

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, () => {
  console.log(`Catalog API listening on http://localhost:${PORT}`);
  console.log(`Admin UI: http://localhost:${PORT}/admin.html`);
  if (!process.env.ADMIN_PASSWORD?.trim()) {
    console.warn(
      "ADMIN_PASSWORD is not set — admin login and /admin/products are disabled."
    );
  }
  if (!process.env.SESSION_SECRET?.trim()) {
    console.warn(
      "SESSION_SECRET is not set — using insecure dev default (set in production)."
    );
  }
});
