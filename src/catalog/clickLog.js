import fs from "fs";
import path from "path";
import { useRedis } from "./storageMode.js";

const DATA_DIR = path.join(process.cwd(), "data");
const CLICKS_FILE = path.join(DATA_DIR, "clicks.jsonl");
const KV_CLICKS_KEY = "catalog:clicks";
const MAX_CLICKS = 5000;

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Append-only click log (commission-safe: does not call AliExpress; only records your own events).
 */
export async function appendClick(entry) {
  const lineObj = {
    ...entry,
    t: new Date().toISOString(),
  };

  if (useRedis()) {
    const { Redis } = await import("@upstash/redis");
    const redis = Redis.fromEnv();
    const raw = await redis.get(KV_CLICKS_KEY);
    let arr = Array.isArray(raw) ? raw : [];
    if (typeof raw === "string") {
      try {
        const p = JSON.parse(raw);
        arr = Array.isArray(p) ? p : [];
      } catch {
        arr = [];
      }
    }
    arr.push(lineObj);
    const tail = arr.slice(-MAX_CLICKS);
    await redis.set(KV_CLICKS_KEY, tail);
    return;
  }

  ensureDataDir();
  const line = JSON.stringify(lineObj) + "\n";
  fs.appendFileSync(CLICKS_FILE, line, "utf8");
}
