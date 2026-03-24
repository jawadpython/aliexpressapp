import fs from "fs";
import path from "path";
import crypto from "crypto";
import { extractProductIdFromUrl } from "./extractProductId.js";
import { useBlob, isVercelDeploy } from "./storageMode.js";
import {
  blobReadJson,
  blobWriteJson,
  BLOB_PATH_PRODUCTS,
} from "./blobJson.js";

const DATA_DIR = path.join(process.cwd(), "data");
const PRODUCTS_FILE = path.join(DATA_DIR, "products.json");

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadProductsFromFs() {
  if (isVercelDeploy() && !useBlob()) {
    return [];
  }
  ensureDataDir();
  if (!fs.existsSync(PRODUCTS_FILE)) {
    fs.writeFileSync(PRODUCTS_FILE, "[]", "utf8");
    return [];
  }
  try {
    const raw = fs.readFileSync(PRODUCTS_FILE, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveProductsToFs(list) {
  if (isVercelDeploy() && !useBlob()) {
    throw new Error(
      "Vercel Blob is not connected. In Vercel: project → Storage → Blob → create a store → Connect to this project (BLOB_READ_WRITE_TOKEN) → Redeploy."
    );
  }
  ensureDataDir();
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(list, null, 2), "utf8");
}

async function loadProductsRaw() {
  if (useBlob()) {
    const data = await blobReadJson(BLOB_PATH_PRODUCTS);
    return Array.isArray(data) ? data : [];
  }
  return loadProductsFromFs();
}

async function saveProductsRaw(list) {
  if (useBlob()) {
    await blobWriteJson(BLOB_PATH_PRODUCTS, list);
    return;
  }
  saveProductsToFs(list);
}

/**
 * @param {Array<{ id: string, affiliate_link?: string, product_id?: string | null }>} list
 * @param {{ affiliate_link: string, product_id: string | null, excludeId?: string }} opts
 */
function assertNotDuplicate(list, { affiliate_link, product_id, excludeId }) {
  const link = String(affiliate_link).trim();
  for (const p of list) {
    if (excludeId && p.id === excludeId) continue;
    const plink = String(p.affiliate_link ?? "").trim();
    if (plink === link) {
      const err = new Error(
        "This affiliate link is already in the catalog."
      );
      err.code = "DUPLICATE";
      throw err;
    }
    if (
      product_id &&
      p.product_id != null &&
      String(p.product_id) === String(product_id)
    ) {
      const err = new Error(
        "This AliExpress product is already listed (same item as another entry)."
      );
      err.code = "DUPLICATE";
      throw err;
    }
  }
}

/**
 * Store affiliate link exactly as provided (only trims surrounding whitespace).
 */
export async function addProduct({ affiliateLink, title, image, price, currency }) {
  const affiliate_link = String(affiliateLink ?? "").trim();
  if (!affiliate_link) throw new Error("affiliateLink is required");

  const titleStr = String(title ?? "").trim();
  if (!titleStr) throw new Error("title is required");

  const imageStr = String(image ?? "").trim();
  if (!imageStr) throw new Error("image is required");

  const priceStr =
    price === undefined || price === null ? "" : String(price).trim();
  const currencyStr =
    currency === undefined || currency === null
      ? ""
      : String(currency).trim() || "";

  const product_id = extractProductIdFromUrl(affiliate_link);

  const list = await loadProductsRaw();
  assertNotDuplicate(list, { affiliate_link, product_id });

  const row = {
    id: crypto.randomUUID(),
    affiliate_link,
    product_id,
    title: titleStr,
    image: imageStr,
    price: priceStr,
    currency: currencyStr,
    createdAt: new Date().toISOString(),
  };

  list.push(row);
  await saveProductsRaw(list);
  return row;
}

export async function updateProduct(id, { affiliateLink, title, image, price, currency }) {
  const list = await loadProductsRaw();
  const idx = list.findIndex((p) => p.id === id);
  if (idx === -1) return null;

  const affiliate_link = String(affiliateLink ?? "").trim();
  if (!affiliate_link) throw new Error("affiliateLink is required");

  const titleStr = String(title ?? "").trim();
  if (!titleStr) throw new Error("title is required");

  const imageStr = String(image ?? "").trim();
  if (!imageStr) throw new Error("image is required");

  const prev = list[idx];
  const priceStr =
    price === undefined || price === null
      ? prev.price
      : String(price).trim();
  const currencyStr =
    currency === undefined || currency === null
      ? prev.currency
      : String(currency).trim() || "";

  const product_id = extractProductIdFromUrl(affiliate_link);

  assertNotDuplicate(list, { affiliate_link, product_id, excludeId: id });

  const row = {
    ...prev,
    affiliate_link,
    product_id,
    title: titleStr,
    image: imageStr,
    price: priceStr,
    currency: currencyStr,
    updatedAt: new Date().toISOString(),
  };

  list[idx] = row;
  await saveProductsRaw(list);
  return row;
}

export async function deleteProduct(id) {
  const list = await loadProductsRaw();
  const next = list.filter((p) => p.id !== id);
  if (next.length === list.length) return false;
  await saveProductsRaw(next);
  return true;
}

export async function getById(id) {
  const list = await loadProductsRaw();
  return list.find((p) => p.id === id) ?? null;
}

/** All products (async; Vercel Blob on production, files locally). */
export async function loadProductsList() {
  return loadProductsRaw();
}

/**
 * Map stored row to public API shape (camelCase for mobile). affiliateLink is byte-identical to stored link.
 */
export function toPublicDto(row) {
  return {
    id: row.id,
    productId: row.product_id ?? null,
    title: row.title,
    image: row.image,
    salePrice: row.price,
    originalPrice: null,
    discount: null,
    currency: row.currency,
    affiliateLink: row.affiliate_link,
    shipping: null,
    safeForMorocco: false,
    aliexpressChoice: false,
    platformProductType: null,
    source: "catalog",
  };
}
