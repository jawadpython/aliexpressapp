/**
 * AliExpress Affiliate API — two credential systems:
 *
 * 1) **Singapore sync** (`api-sg.aliexpress.com/sync`) — keys from **portals.aliexpress.com**;
 *    sign: HMAC-SHA256 over sorted `key+value` (no secret bookends). `sign_method: sha256`.
 * 2) **Taobao router** (`eco.taobao.com/router/rest`) — older Open Platform keys;
 *    sign: MD5 bookends. `sign_method: md5`, Shanghai timestamp string.
 *
 * Portals keys return **error 29** on the Taobao router — they are not registered there.
 *
 * Set `ALIEXPRESS_API_MODE=sg` (default) or `taobao`.
 *
 * @see https://developers.aliexpress.com/
 */

import crypto from "crypto";

/**
 * Official HTTPS entry (Taobao doc). On some networks `gw.api.taobao.com` times out;
 * `eco.taobao.com` is the documented HTTPS router and usually works.
 */
const DEFAULT_GATEWAY = "https://eco.taobao.com/router/rest";

function gatewayUrl() {
  const u = process.env.ALIEXPRESS_GATEWAY_URL?.trim();
  return u || DEFAULT_GATEWAY;
}

/**
 * Sort object keys alphabetically (Taobao signing requirement).
 */
function sortObject(obj) {
  return Object.keys(obj)
    .sort()
    .reduce((acc, key) => {
      acc[key] = obj[key];
      return acc;
    }, {});
}

/**
 * Build MD5 sign: secret + key1value1key2value2... + secret → MD5 hex uppercase.
 * All values are coerced to strings for the signature string.
 */
export function signRequest(parameters, appSecret) {
  const sortedParams = sortObject(parameters);
  const sortedString = Object.keys(sortedParams).reduce((acc, key) => {
    const val = sortedParams[key];
    if (val === undefined || val === null) return acc;
    return `${acc}${key}${String(val)}`;
  }, "");
  const wrapped = `${appSecret}${sortedString}${appSecret}`;
  return crypto.createHash("md5").update(wrapped, "utf8").digest("hex").toUpperCase();
}

/**
 * Shanghai time: YYYY-MM-DD HH:mm:ss (required by Taobao-style APIs).
 */
export function shanghaiTimestamp() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

/**
 * Portals / Singapore API: HMAC-SHA256, sorted key+value concatenation (no bookends).
 * @see https://www.oriollopez.com/posts/how-to-use-aliexpress-affiliates-with-nodejs/
 */
function signSingaporeHmac(params, appSecret) {
  const keys = Object.keys(params)
    .filter((k) => k !== "sign")
    .sort();
  const str = keys.map((k) => `${k}${String(params[k])}`).join("");
  return crypto.createHmac("sha256", appSecret).update(str, "utf8").digest("hex").toUpperCase();
}

async function querySingaporeSync({ appKey, appSecret, business }) {
  const timestamp = Date.now();
  const payload = {
    method: "aliexpress.affiliate.product.query",
    app_key: appKey,
    sign_method: "sha256",
    timestamp,
    format: "json",
    v: "2.0",
    ...business,
  };

  const sign = signSingaporeHmac(payload, appSecret);
  const all = { ...payload, sign };

  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(all)) {
    if (v === undefined || v === null) continue;
    usp.append(k, String(v));
  }

  const base =
    process.env.ALIEXPRESS_SG_URL?.trim() || "https://api-sg.aliexpress.com/sync";

  const res = await fetch(base, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
    },
    body: usp.toString(),
    signal: AbortSignal.timeout(45_000),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from AliExpress Singapore API (HTTP ${res.status})`);
  }

  return json;
}

/**
 * Taobao router: MD5 signing + POST form (older Open Platform apps).
 */
async function queryTaobaoRouter({ appKey, appSecret, business }) {
  const timestamp = shanghaiTimestamp();

  const payload = {
    method: "aliexpress.affiliate.product.query",
    app_key: appKey,
    sign_method: "md5",
    timestamp,
    format: "json",
    v: "2.0",
    ...business,
  };

  const sign = signRequest(payload, appSecret);
  const body = new URLSearchParams({ ...payload, sign });

  const primary = gatewayUrl();
  const fallbacks = [
    primary,
    "https://eco.taobao.com/router/rest",
    "https://gw.api.taobao.com/router/rest",
    "http://gw.api.taobao.com/router/rest",
  ].filter((u, i, a) => a.indexOf(u) === i);

  let res;
  const attemptErrors = [];
  for (const url of fallbacks) {
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
        },
        body,
        signal: AbortSignal.timeout(45_000),
      });
      break;
    } catch (e) {
      const cause = e?.cause;
      const detail = [cause?.code, cause?.message ?? cause, e?.message]
        .filter(Boolean)
        .join(" ");
      attemptErrors.push(`${url} → ${detail || e}`);
      res = null;
    }
  }

  if (!res) {
    throw new Error(
      `Network error calling AliExpress gateway. Tried:\n${attemptErrors.join("\n")}`
    );
  }

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from AliExpress gateway (HTTP ${res.status})`);
  }

  return json;
}

/**
 * Call aliexpress.affiliate.product.query — routes to Singapore or Taobao based on `ALIEXPRESS_API_MODE`.
 */
export async function queryAffiliateProducts({ appKey, appSecret, business }) {
  const mode = (process.env.ALIEXPRESS_API_MODE || "sg").toLowerCase();
  if (mode === "taobao") {
    return queryTaobaoRouter({ appKey, appSecret, business });
  }
  return querySingaporeSync({ appKey, appSecret, business });
}

/**
 * Normalize API product records to our public DTO.
 * Field names vary slightly across API versions — we accept common aliases.
 */
export function mapProductToDto(raw, index) {
  const title =
    raw.product_title ??
    raw.productTitle ??
    raw.title ??
    "";

  const image =
    raw.product_main_image_url ??
    raw.productMainImageUrl ??
    raw.image_url ??
    (Array.isArray(raw.product_small_image_urls?.string)
      ? raw.product_small_image_urls.string[0]
      : raw.product_small_image_urls) ??
    "";

  const salePrice =
    raw.target_sale_price ??
    raw.targetSalePrice ??
    raw.sale_price ??
    raw.salePrice;

  const originalPrice =
    raw.target_original_price ??
    raw.targetOriginalPrice ??
    raw.original_price ??
    raw.originalPrice;

  const discount =
    raw.discount ??
    raw.discount_value ??
    raw.discountValue;

  const affiliateLink =
    raw.promotion_link ??
    raw.promotionLink ??
    raw.affiliate_link ??
    raw.track_link ??
    raw.url ??
    "";

  const currency =
    raw.target_currency ??
    raw.targetCurrency ??
    raw.currency ??
    "";

  // Shipping-related hints (best-effort; API shape may differ)
  const shipping =
    raw.ship_to_days != null
      ? `Est. ${raw.ship_to_days} day(s)`
      : raw.free_shipping === "true" || raw.free_shipping === true
        ? "Free shipping"
        : raw.logistics ?? raw.shipping_info ?? raw.shippingInfo ?? null;

  const saleNum = parseFloat(String(salePrice ?? "").replace(/,/g, ""));
  // API does not offer MAD; rough “~300 MAD” hint in USD/EUR (tune via SAFE_THRESHOLD_USD / SAFE_THRESHOLD_EUR)
  const maxUsd = Number(process.env.SAFE_THRESHOLD_USD ?? "33");
  const maxEur = Number(process.env.SAFE_THRESHOLD_EUR ?? "30");
  const safeForMorocco =
    Number.isFinite(saleNum) &&
    saleNum > 0 &&
    ((currency === "USD" && saleNum < maxUsd) ||
      (currency === "EUR" && saleNum < maxEur) ||
      (currency === "MAD" && saleNum < 300));

  const platformProductType =
    raw.platform_product_type ?? raw.platformProductType ?? null;
  const pt = platformProductType != null ? String(platformProductType).toUpperCase() : "";
  // Badge: API Choice flags OR PLAZA channel (closest affiliate feed has to “Choice-style” offers)
  const aliexpressChoice = detectAliexpressChoice(raw) || pt === "PLAZA";

  return {
    id: String(raw.product_id ?? raw.productId ?? `idx-${index}`),
    title,
    image,
    salePrice: salePrice != null ? String(salePrice) : null,
    originalPrice: originalPrice != null ? String(originalPrice) : null,
    discount: discount != null ? String(discount) : null,
    currency: currency || null,
    affiliateLink,
    shipping,
    safeForMorocco,
    aliexpressChoice,
    platformProductType:
      platformProductType != null ? String(platformProductType) : null,
  };
}

/**
 * Best-effort: affiliate payloads sometimes include tags/flags for Choice-style offers.
 * Full “AliExpress commitment” copy still lives on the web PDP after opening the affiliate link.
 */
export function detectAliexpressChoice(raw) {
  if (!raw || typeof raw !== "object") return false;

  const truthy = (v) =>
    v === true ||
    v === 1 ||
    v === "1" ||
    v === "Y" ||
    v === "y" ||
    String(v).toLowerCase() === "true";

  const direct = [
    raw.ae_choice,
    raw.is_ae_choice,
    raw.is_choice,
    raw.choice_flag,
    raw.aliexpress_choice,
    raw.choice,
  ];
  if (direct.some(truthy)) return true;

  const tags = raw.product_tags ?? raw.promotion_tags ?? raw.tags;
  if (Array.isArray(tags)) {
    if (
      tags.some((t) => String(t).toLowerCase().includes("choice"))
    ) {
      return true;
    }
  }
  if (typeof tags === "string" && tags.toLowerCase().includes("choice")) {
    return true;
  }

  // Avoid broad JSON scans — they false-positive and break Choice-only filters.

  return false;
}

/**
 * Extract product array and total count from gateway JSON.
 */
export function extractProductsFromResponse(data) {
  if (data?.error_response) {
    const err = data.error_response;
    const msg = err.msg ?? err.sub_msg ?? "AliExpress API error";
    const code = err.code ?? err.sub_code ?? "";
    throw new Error(code ? `${msg} (${code})` : msg);
  }

  const root = data?.aliexpress_affiliate_product_query_response;
  if (!root) {
    return { products: [], total: 0 };
  }

  const rr = root.resp_result;
  if (rr?.resp_code && String(rr.resp_code) !== "200") {
    throw new Error(rr.resp_msg ? `${rr.resp_msg} (${rr.resp_code})` : "AliExpress API error");
  }

  const result = rr?.result ?? root.result;
  if (!result) {
    return { products: [], total: 0 };
  }

  let list = result.products?.product ?? result.products;
  if (!list) list = [];
  if (!Array.isArray(list)) list = [list];

  const total = Number(result.total_record_count ?? result.total ?? list.length) || list.length;

  return { products: list, total };
}
