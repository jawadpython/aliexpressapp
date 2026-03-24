import { get, put } from "@vercel/blob";

/** Stable paths in your Blob store (private — not public URLs). */
export const BLOB_PATH_PRODUCTS = "catalog/products.json";
export const BLOB_PATH_CLICKS = "catalog/clicks.json";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function streamToText(stream) {
  return new Response(stream).text();
}

export async function blobReadJson(pathname) {
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
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
      lastErr = e;
      if (attempt < 3) await sleep(120 * Math.pow(2, attempt));
    }
  }
  throw lastErr;
}

/** Writes JSON to Blob with retries (transient network / rate limits on serverless). */
export async function blobWriteJson(pathname, value) {
  const body = JSON.stringify(value);
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await put(pathname, body, {
        access: "private",
        allowOverwrite: true,
        contentType: "application/json",
      });
      return;
    } catch (e) {
      lastErr = e;
      if (attempt < 3) await sleep(180 * Math.pow(2, attempt));
    }
  }
  throw lastErr;
}
