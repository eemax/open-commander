import type { DetectedColumn, ProcessingIssue } from "./types";

export type ColumnSpec<TKey extends string> = {
  key: TKey;
  label: string;
  aliases: string[];
  fallbackIndex: number;
  required: boolean;
};

export type TableLayout<TKey extends string> = {
  headerRowIndex: number | null;
  dataStartIndex: number;
  columns: Map<TKey, DetectedColumn>;
  issues: ProcessingIssue[];
};

type CandidateColumn = {
  columnIndex: number;
  score: number;
};

const EXCEL_COLUMN_NAMES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function excelColumnName(index: number): string {
  let dividend = index + 1;
  let name = "";

  while (dividend > 0) {
    const modulo = (dividend - 1) % 26;
    name = EXCEL_COLUMN_NAMES[modulo] + name;
    dividend = Math.floor((dividend - modulo) / 26);
  }

  return name;
}

export function normalizeHeaderText(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[&+]/g, " and ")
    .replace(/[#№]/g, " number ")
    .replace(/[_./\\-]+/g, " ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

export function compactHeaderText(input: string): string {
  return normalizeHeaderText(input).replace(/\s+/g, "");
}

export function isMissingText(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "" ||
    normalized === "nan" ||
    normalized === "null" ||
    normalized === "undefined" ||
    normalized === "n/a"
  );
}

export function normalizeDataText(value: string): string {
  return value.replace(/\u00a0/g, " ").trim();
}

export function normalizeProductKey(value: string): string {
  return normalizeDataText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s._-]+/g, "");
}

export function detectTableLayout<TKey extends string>(
  rows: string[][],
  specs: ColumnSpec<TKey>[],
): TableLayout<TKey> {
  const maxColumns = Math.max(0, ...rows.map((row) => row.length));
  const header = findLikelyHeaderRow(rows, specs);

  if (header === null) {
    return fallbackLayout(specs, maxColumns);
  }

  const assigned = assignColumnsFromHeader(rows[header] ?? [], specs, maxColumns);
  const issues: ProcessingIssue[] = [];

  for (const spec of specs) {
    if (spec.required && !assigned.has(spec.key)) {
      issues.push({
        severity: "error",
        field: spec.key,
        message: `Could not find required column "${spec.label}".`,
      });
    }
  }

  return {
    headerRowIndex: header,
    dataStartIndex: header + 1,
    columns: assigned,
    issues,
  };
}

function findLikelyHeaderRow<TKey extends string>(
  rows: string[][],
  specs: ColumnSpec<TKey>[],
): number | null {
  const requiredSpecs = specs.filter((spec) => spec.required);
  const scanLimit = Math.min(rows.length, 15);
  let best: { rowIndex: number; score: number; matchedRequired: number } | null =
    null;

  for (let rowIndex = 0; rowIndex < scanLimit; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const candidates = requiredSpecs.map((spec) =>
      bestHeaderColumnForSpec(row, spec, new Set()),
    );
    const matchedRequired = candidates.filter(
      (candidate) => candidate && candidate.score >= 2,
    ).length;
    const score = candidates.reduce(
      (total, candidate) => total + (candidate?.score ?? 0),
      0,
    );

    if (
      matchedRequired >= Math.min(2, requiredSpecs.length) &&
      (!best || score > best.score)
    ) {
      best = { rowIndex, score, matchedRequired };
    }
  }

  return best?.rowIndex ?? null;
}

function assignColumnsFromHeader<TKey extends string>(
  row: string[],
  specs: ColumnSpec<TKey>[],
  maxColumns: number,
): Map<TKey, DetectedColumn> {
  const assigned = new Map<TKey, DetectedColumn>();
  const usedColumns = new Set<number>();
  const orderedSpecs = [
    ...specs.filter((spec) => spec.required),
    ...specs.filter((spec) => !spec.required),
  ];

  for (const spec of orderedSpecs) {
    const best = bestHeaderColumnForSpec(row, spec, usedColumns);

    if (best && best.score >= 2) {
      assigned.set(spec.key, {
        key: spec.key,
        label: spec.label,
        columnIndex: best.columnIndex,
        columnName: excelColumnName(best.columnIndex),
        match: "header",
      });
      usedColumns.add(best.columnIndex);
      continue;
    }

    if (
      spec.fallbackIndex >= 0 &&
      spec.fallbackIndex < maxColumns &&
      !usedColumns.has(spec.fallbackIndex)
    ) {
      assigned.set(spec.key, {
        key: spec.key,
        label: spec.label,
        columnIndex: spec.fallbackIndex,
        columnName: excelColumnName(spec.fallbackIndex),
        match: "fallback",
      });
      usedColumns.add(spec.fallbackIndex);
    }
  }

  return assigned;
}

function fallbackLayout<TKey extends string>(
  specs: ColumnSpec<TKey>[],
  maxColumns: number,
): TableLayout<TKey> {
  const assigned = new Map<TKey, DetectedColumn>();
  const issues: ProcessingIssue[] = [
    {
      severity: "info",
      message: "No header row was detected, so columns were read by position.",
    },
  ];

  for (const spec of specs) {
    if (spec.fallbackIndex >= 0 && spec.fallbackIndex < maxColumns) {
      assigned.set(spec.key, {
        key: spec.key,
        label: spec.label,
        columnIndex: spec.fallbackIndex,
        columnName: excelColumnName(spec.fallbackIndex),
        match: "fallback",
      });
      continue;
    }

    if (spec.required) {
      issues.push({
        severity: "error",
        field: spec.key,
        message: `Could not find required column "${spec.label}".`,
      });
    }
  }

  return {
    headerRowIndex: null,
    dataStartIndex: 0,
    columns: assigned,
    issues,
  };
}

function bestHeaderColumnForSpec<TKey extends string>(
  row: string[],
  spec: ColumnSpec<TKey>,
  usedColumns: Set<number>,
): CandidateColumn | null {
  let best: CandidateColumn | null = null;

  for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
    if (usedColumns.has(columnIndex)) {
      continue;
    }

    const score = scoreHeader(row[columnIndex] ?? "", spec.aliases);

    if (score > (best?.score ?? 0)) {
      best = { columnIndex, score };
    }
  }

  return best;
}

function scoreHeader(header: string, aliases: string[]): number {
  const normalized = normalizeHeaderText(header);
  const compact = compactHeaderText(header);

  if (!normalized) {
    return 0;
  }

  let best = 0;

  for (const alias of aliases) {
    const aliasNormalized = normalizeHeaderText(alias);
    const aliasCompact = compactHeaderText(alias);

    if (!aliasNormalized) {
      continue;
    }

    if (compact === aliasCompact || normalized === aliasNormalized) {
      best = Math.max(best, 4);
      continue;
    }

    if (compact.includes(aliasCompact) && aliasCompact.length >= 3) {
      best = Math.max(best, 3);
      continue;
    }

    const headerTokens = new Set(normalized.split(" "));
    const aliasTokens = aliasNormalized.split(" ");

    if (aliasTokens.every((token) => headerTokens.has(token))) {
      best = Math.max(best, aliasTokens.length > 1 ? 2.8 : 2.2);
    }
  }

  return best;
}
