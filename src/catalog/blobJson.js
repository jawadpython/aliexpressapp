import { get, put } from "@vercel/blob";

/** Stable paths in your Blob store (private — not public URLs). */
export const BLOB_PATH_PRODUCTS = "catalog/products.json";
export const BLOB_PATH_CLICKS = "catalog/clicks.json";

async function streamToText(stream) {
  return new Response(stream).text();
}

export async function blobReadJson(pathname) {
  try {
    const res = await get(pathname, { access: "private" });
    if (!res || res.statusCode !== 200 || !res.stream) return null;
    const text = await streamToText(res.stream);
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  } catch (e) {
    const name = e?.constructor?.name ?? "";
    if (/not found|BlobNotFound/i.test(String(e?.message)) || name.includes("NotFound")) {
      return null;
    }
    throw e;
  }
}

export async function blobWriteJson(pathname, value) {
  const body = JSON.stringify(value);
  await put(pathname, body, {
    access: "private",
    allowOverwrite: true,
    contentType: "application/json",
  });
}
