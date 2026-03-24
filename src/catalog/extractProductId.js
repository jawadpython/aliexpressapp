/**
 * Best-effort AliExpress item id from a URL (never modifies the URL itself).
 */
export function extractProductIdFromUrl(urlString) {
  if (!urlString || typeof urlString !== "string") return null;
  const s = urlString.trim();
  const m =
    s.match(/\/item\/(\d{5,})\.html/i) ||
    s.match(/\/i\/(\d{5,})\.html/i) ||
    s.match(/[?&](?:item_id|productId|id)=(\d{5,})/i);
  return m ? m[1] : null;
}
