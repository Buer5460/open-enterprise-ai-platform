export type SemVer = {
  major: number;
  minor: number;
  patch: number;
  prerelease: Array<string | number>;
};

/**
 * Small dependency-range evaluator for OEAP Package manifests.
 *
 * Supported syntax intentionally stays deterministic and fail-closed:
 * - exact: 1.2.3
 * - wildcard: *, latest, 1.x, 1.2.x
 * - caret: ^1.2.3, ^0.2.0, ^0.0.3
 * - tilde: ~1.2.3
 * - comparators: > >= < <= =
 * - AND: ">=1.2.0 <2.0.0"
 * - OR: "^1.5.0 || ^2.0.0"
 */
export function satisfiesSemverRange(
  version: string,
  range: string
): boolean {
  const current = parseSemver(version);
  if (!current) return false;

  const normalized = range.trim();
  if (!normalized || normalized === "*" || normalized === "latest") {
    return true;
  }

  const alternatives = normalized
    .split("||")
    .map((part) => part.trim())
    .filter(Boolean);

  if (alternatives.length === 0) {
    return false;
  }

  return alternatives.some((alternative) =>
    satisfiesAndRange(current, alternative)
  );
}

export function parseSemver(
  value: string
): SemVer | undefined {
  const match = value.trim().match(
    /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
  );

  if (!match) return undefined;

  const prerelease = match[4]
    ? match[4].split(".").map((part) =>
        /^0$|^[1-9]\d*$/.test(part)
          ? Number(part)
          : part
      )
    : [];

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease
  };
}

export function compareSemver(
  left: SemVer,
  right: SemVer
): number {
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) {
      return left[key] < right[key] ? -1 : 1;
    }
  }

  const leftPre = left.prerelease;
  const rightPre = right.prerelease;

  if (leftPre.length === 0 && rightPre.length === 0) return 0;
  if (leftPre.length === 0) return 1;
  if (rightPre.length === 0) return -1;

  const length = Math.max(leftPre.length, rightPre.length);
  for (let index = 0; index < length; index += 1) {
    const a = leftPre[index];
    const b = rightPre[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (a === b) continue;

    const aNumber = typeof a === "number";
    const bNumber = typeof b === "number";
    if (aNumber && bNumber) return a < b ? -1 : 1;
    if (aNumber) return -1;
    if (bNumber) return 1;
    return String(a) < String(b) ? -1 : 1;
  }

  return 0;
}

function satisfiesAndRange(
  current: SemVer,
  range: string
): boolean {
  const wildcard = wildcardBounds(range);
  if (wildcard) {
    return withinBounds(current, wildcard.lower, wildcard.upper);
  }

  if (/^[v]?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(range)) {
    const exact = parseSemver(range);
    return Boolean(exact && compareSemver(current, exact) === 0);
  }

  if (range.startsWith("^")) {
    const base = parseSemver(range.slice(1));
    if (!base) return false;
    return withinBounds(current, base, caretUpperBound(base));
  }

  if (range.startsWith("~")) {
    const base = parseSemver(range.slice(1));
    if (!base) return false;
    return withinBounds(current, base, {
      major: base.major,
      minor: base.minor + 1,
      patch: 0,
      prerelease: []
    });
  }

  const comparators = range
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (comparators.length === 0) return false;
  return comparators.every((comparator) =>
    satisfiesComparator(current, comparator)
  );
}

function satisfiesComparator(
  current: SemVer,
  expression: string
): boolean {
  const match = expression.match(/^(>=|<=|>|<|=)?(.+)$/);
  if (!match) return false;

  const operator = match[1] || "=";
  const expected = parseSemver(match[2]);
  if (!expected) return false;

  const comparison = compareSemver(current, expected);
  switch (operator) {
    case ">":
      return comparison > 0;
    case ">=":
      return comparison >= 0;
    case "<":
      return comparison < 0;
    case "<=":
      return comparison <= 0;
    case "=":
      return comparison === 0;
    default:
      return false;
  }
}

function wildcardBounds(
  range: string
): { lower: SemVer; upper: SemVer } | undefined {
  const majorOnly = range.match(/^(\d+)\.(?:x|X|\*)$/);
  if (majorOnly) {
    const major = Number(majorOnly[1]);
    return {
      lower: version(major, 0, 0),
      upper: version(major + 1, 0, 0)
    };
  }

  const minor = range.match(/^(\d+)\.(\d+)\.(?:x|X|\*)$/);
  if (minor) {
    const major = Number(minor[1]);
    const minorValue = Number(minor[2]);
    return {
      lower: version(major, minorValue, 0),
      upper: version(major, minorValue + 1, 0)
    };
  }

  return undefined;
}

function caretUpperBound(base: SemVer): SemVer {
  if (base.major > 0) {
    return version(base.major + 1, 0, 0);
  }
  if (base.minor > 0) {
    return version(0, base.minor + 1, 0);
  }
  return version(0, 0, base.patch + 1);
}

function withinBounds(
  current: SemVer,
  lower: SemVer,
  upper: SemVer
): boolean {
  return compareSemver(current, lower) >= 0 &&
    compareSemver(current, upper) < 0;
}

function version(
  major: number,
  minor: number,
  patch: number
): SemVer {
  return {
    major,
    minor,
    patch,
    prerelease: []
  };
}
