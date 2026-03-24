/**
 * Vercel Blob — use when BLOB_READ_WRITE_TOKEN is set (add Blob from Vercel Storage).
 * Local dev uses backend/data/*.json when no token.
 */
export function useBlob() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

export function isVercelDeploy() {
  return process.env.VERCEL === "1";
}

/** True when deployed on Vercel but Blob is not connected — catalog cannot persist. */
export function needsBlobOnVercel() {
  return isVercelDeploy() && !useBlob();
}

export function vercelStorageHint() {
  if (needsBlobOnVercel()) {
    return "Connect Vercel Blob: project → Storage → Create Blob store → link to this project (BLOB_READ_WRITE_TOKEN), then Redeploy.";
  }
  return null;
}
