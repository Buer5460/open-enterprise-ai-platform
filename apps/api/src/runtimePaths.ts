import {
  isAbsolute,
  join,
  resolve
} from "node:path";

export function runtimeDataRoot(
  repoRoot: string
): string {
  const configured =
    process.env.OEAP_DATA_DIR?.trim();

  if (!configured) {
    return join(repoRoot, ".tmp");
  }

  return isAbsolute(configured)
    ? configured
    : resolve(repoRoot, configured);
}

export function runtimePath(
  repoRoot: string,
  ...segments: string[]
): string {
  return join(
    runtimeDataRoot(repoRoot),
    ...segments
  );
}

export function harnessRoot(
  openEnterpriseRoot: string
): string {
  const configured =
    process.env.OEAP_HARNESS_ROOT?.trim();

  return configured
    ? (
        isAbsolute(configured)
          ? configured
          : resolve(openEnterpriseRoot, configured)
      )
    : join(openEnterpriseRoot, "deepseek-harness");
}

export function dshHome(
  openEnterpriseRoot: string
): string {
  const configured =
    process.env.OEAP_DSH_HOME?.trim();

  return configured
    ? (
        isAbsolute(configured)
          ? configured
          : resolve(openEnterpriseRoot, configured)
      )
    : join(openEnterpriseRoot, ".dsh-dev");
}
