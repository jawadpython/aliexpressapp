import path from "path";
import express from "express";
import cors from "cors";
import {
  createSessionMiddleware,
  requireAdmin,
  postAdminLogin,
  postAdminLogout,
  getAdminSession,
} from "./adminAuth.js";
import {
  loadProductsList,
  addProduct,
  updateProduct,
  deleteProduct,
  getById,
  toPublicDto,
} from "./catalog/catalogStore.js";
import { appendClick } from "./catalog/clickLog.js";
import {
  useBlob,
  vercelStorageHint,
  isVercelDeploy,
  needsBlobOnVercel,
} from "./catalog/storageMode.js";

const publicDir = path.join(process.cwd(), "public");

const SORT_ALIASES = {
  orders_desc: "LAST_VOLUME_DESC",
  priceasc: "SALE_PRICE_ASC",
  pricedesc: "SALE_PRICE_DESC",
  volumeasc: "LAST_VOLUME_ASC",
  volumedesc: "LAST_VOLUME_DESC",
  sale_price_asc: "SALE_PRICE_ASC",
  sale_price_desc: "SALE_PRICE_DESC",
  last_volume_asc: "LAST_VOLUME_ASC",
  last_volume_desc: "LAST_VOLUME_DESC",
};

function normalizeSort(sortRaw) {
  const s = String(sortRaw || "").trim();
  const key = s.replace(/[-\s]/g, "_").toLowerCase();
  return SORT_ALIASES[key] ?? s;
}

function corsOptions() {
  const raw = process.env.CORS_ORIGINS;
  if (!raw || raw === "*") return { origin: true };
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return {
    origin: (origin, cb) => {
      if (!origin || list.includes(origin)) cb(null, true);
      else cb(null, false);
    },
  };
}

function isAllowedAffiliateUrl(urlString) {
  try {
    const u = new URL(urlString);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    return (
      h === "s.click.aliexpress.com" ||
      h === "aliexpress.com" ||
      h.endsWith(".aliexpress.com")
    );
  } catch {
    return false;
  }
}

function parsePriceNum(s) {
  const n = parseFloat(String(s ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

const app = express();
app.set("trust proxy", 1);

/**
 * Vercel rewrites traffic to the function; `req.url` can be `/api` while the client
 * requested `/admin/login`. Express routing uses `req.url`, so align it with `originalUrl`.
 */
app.use((req, _res, next) => {
  if (req.originalUrl && req.originalUrl !== req.url) {
    req.url = req.originalUrl;
  }
  next();
});

app.use(cors(corsOptions()));
app.use(express.json());
app.use(createSessionMiddleware());
app.use(express.static(publicDir));

app.post("/admin/login", postAdminLogin);
app.post("/admin/logout", postAdminLogout);
app.get("/admin/session", getAdminSession);

app.get("/health", (_req, res) => {
  const hint = vercelStorageHint();
  res.json({
    ok: true,
    mode: "catalog",
    storage: useBlob() ? "vercel-blob" : "filesystem",
    onVercel: isVercelDeploy(),
    needsBlob: needsBlobOnVercel(),
    ...(hint ? { warning: hint } : {}),
  });
});

app.get("/products", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
    const pageSize = Math.min(
      50,
      Math.max(1, parseInt(String(req.query.pageSize || "20"), 10) || 20)
    );
    const keywords = String(req.query.keywords || "").trim();
    const sortRaw =
      String(req.query.sort || "LAST_VOLUME_DESC").trim() || "LAST_VOLUME_DESC";
    const sort = normalizeSort(sortRaw);

    const minSalePrice = req.query.minSalePrice;
    const maxSalePrice = req.query.maxSalePrice;

    let rows = await loadProductsList();

    const kw = keywords.toLowerCase();
    if (kw && kw !== "best seller") {
      rows = rows.filter((r) => r.title.toLowerCase().includes(kw));
    }

    if (minSalePrice !== undefined && minSalePrice !== "") {
      const m = parseFloat(String(minSalePrice));
      if (!Number.isNaN(m)) {
        rows = rows.filter((r) => {
          const p = parsePriceNum(r.price);
          return !Number.isNaN(p) && p >= m;
        });
      }
    }
    if (maxSalePrice !== undefined && maxSalePrice !== "") {
      const m = parseFloat(String(maxSalePrice));
      if (!Number.isNaN(m)) {
        rows = rows.filter((r) => {
          const p = parsePriceNum(r.price);
          return !Number.isNaN(p) && p <= m;
        });
      }
    }

    if (sort === "SALE_PRICE_ASC") {
      rows = [...rows].sort((a, b) => {
        const pa = parsePriceNum(a.price);
        const pb = parsePriceNum(b.price);
        if (Number.isNaN(pa)) return 1;
        if (Number.isNaN(pb)) return -1;
        return pa - pb;
      });
    } else if (sort === "SALE_PRICE_DESC") {
      rows = [...rows].sort((a, b) => {
        const pa = parsePriceNum(a.price);
        const pb = parsePriceNum(b.price);
        if (Number.isNaN(pa)) return 1;
        if (Number.isNaN(pb)) return -1;
        return pb - pa;
      });
    } else {
      rows = [...rows].sort(
        (a, b) =>
          new Date(b.createdAt || 0).getTime() -
          new Date(a.createdAt || 0).getTime()
      );
    }

    const total = rows.length;
    const slice = rows.slice((page - 1) * pageSize, page * pageSize);
    const products = slice.map(toPublicDto);

    return res.json({
      page,
      pageSize,
      total,
      products,
      cached: false,
      source: "catalog",
    });
  } catch (e) {
    console.error("[GET /products]", e);
    return res.status(500).json({ error: "Failed to load catalog" });
  }
});

app.post("/track/click", async (req, res) => {
  const id = req.body?.id;
  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "id required (catalog product id)" });
  }
  try {
    const p = await getById(id.trim());
    if (!p) {
      return res.status(404).json({ error: "Product not found" });
    }
    await appendClick({
      catalogId: p.id,
      productId: p.product_id,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    return res.json({ ok: true });
  } catch (e) {
    console.error("[POST /track/click]", e);
    return res.status(500).json({ error: "Failed to log click" });
  }
});

app.get("/admin/products", requireAdmin, async (_req, res) => {
  try {
    const products = await loadProductsList();
    res.json({ products });
  } catch (e) {
    console.error("[GET /admin/products]", e);
    res.status(500).json({ error: "Failed to load products" });
  }
});

app.post("/admin/products", requireAdmin, async (req, res) => {
  const link = String(req.body?.affiliateLink ?? "").trim();
  if (!isAllowedAffiliateUrl(link)) {
    return res.status(400).json({
      error:
        "Invalid affiliate link. Use https://s.click.aliexpress.com/... or another aliexpress.com URL.",
    });
  }
  try {
    const row = await addProduct({
      affiliateLink: link,
      title: req.body?.title,
      image: req.body?.image,
      price: req.body?.price,
      currency: req.body?.currency,
    });
    return res.status(201).json(row);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Bad request";
    const dup = e && typeof e === "object" && e.code === "DUPLICATE";
    return res.status(dup ? 409 : 400).json({ error: message });
  }
});

app.put("/admin/products/:id", requireAdmin, async (req, res) => {
  const link = String(req.body?.affiliateLink ?? "").trim();
  if (!isAllowedAffiliateUrl(link)) {
    return res.status(400).json({
      error:
        "Invalid affiliate link. Use https://s.click.aliexpress.com/... or another aliexpress.com URL.",
    });
  }
  try {
    const row = await updateProduct(req.params.id, {
      affiliateLink: link,
      title: req.body?.title,
      image: req.body?.image,
      price: req.body?.price,
      currency: req.body?.currency,
    });
    if (!row) return res.status(404).json({ error: "Not found" });
    return res.json(row);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Bad request";
    const dup = e && typeof e === "object" && e.code === "DUPLICATE";
    return res.status(dup ? 409 : 400).json({ error: message });
  }
});

app.delete("/admin/products/:id", requireAdmin, async (req, res) => {
  try {
    const ok = await deleteProduct(req.params.id);
    if (!ok) return res.status(404).json({ error: "Not found" });
    return res.json({ ok: true });
  } catch (e) {
    console.error("[DELETE /admin/products]", e);
    return res.status(500).json({ error: "Failed to delete" });
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

export default app;
