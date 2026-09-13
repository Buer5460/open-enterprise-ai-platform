import {
  isAbsolute,
  join,
  normalize,
  resolve,
  sep
} from "node:path";

/**
 * Rebases legacy paths that were constructed under `<repo>/.tmp/...` onto
 * OEAP_DATA_DIR when an explicit runtime data root is configured.
 *
 * This keeps existing route/store constructors backward compatible while
 * making the persistent-data contract consistent across the platform.
 */
export function runtimeStoragePath(path: string): string {
  const configured = process.env.OEAP_DATA_DIR?.trim();
  if (!configured) {
    return path;
  }

  const normalized = normalize(path);
  const parts = normalized.split(sep);
  const tmpIndex = parts.lastIndexOf(".tmp");

  if (tmpIndex < 0) {
    return path;
  }

  const legacyRoot = parts
    .slice(0, tmpIndex)
    .join(sep);

  const root = isAbsolute(configured)
    ? normalize(configured)
    : resolve(
        legacyRoot || process.cwd(),
        configured
      );

  const suffix = parts.slice(tmpIndex + 1);
  return join(root, ...suffix);
}
