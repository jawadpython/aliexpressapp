import fs from "fs";
import path from "path";
import { useBlob, isVercelDeploy } from "./storageMode.js";
import {
  blobReadJson,
  blobWriteJson,
  BLOB_PATH_CLICKS,
} from "./blobJson.js";

const DATA_DIR = path.join(process.cwd(), "data");
const CLICKS_FILE = path.join(DATA_DIR, "clicks.jsonl");
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

  if (isVercelDeploy() && !useBlob()) {
    return;
  }

  if (useBlob()) {
    const raw = await blobReadJson(BLOB_PATH_CLICKS);
    let arr = Array.isArray(raw) ? raw : [];
    arr.push(lineObj);
    const tail = arr.slice(-MAX_CLICKS);
    await blobWriteJson(BLOB_PATH_CLICKS, tail);
    return;
  }

  ensureDataDir();
  const line = JSON.stringify(lineObj) + "\n";
  fs.appendFileSync(CLICKS_FILE, line, "utf8");
}
