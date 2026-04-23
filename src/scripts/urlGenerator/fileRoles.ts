import type { FileRole } from "./types";
import { compactHeaderText, normalizeHeaderText } from "./headers";

export type NamedFile = {
  name: string;
};

export type FileRoleDetection = {
  role: FileRole | null;
  baseName: string;
};

const ROLE_ORDER: FileRole[] = ["eans", "orders"];

const TOKEN_ROLE_TERMS: Record<FileRole, Set<string>> = {
  eans: new Set(["ean", "eans", "barcode", "barcodes", "gtin", "gtins", "upc"]),
  orders: new Set(["order", "orders", "po", "pos"]),
};

const COMPACT_ROLE_TERMS: Record<FileRole, string[]> = {
  eans: ["eans", "barcodes", "gtins"],
  orders: ["purchaseorder", "purchaseorders", "orders"],
};

const ROLE_REMOVE_PATTERNS: Record<FileRole, RegExp[]> = {
  eans: [
    /(^|[\s_.-])eans?($|[\s_.-])/gi,
    /(^|[\s_.-])barcodes?($|[\s_.-])/gi,
    /(^|[\s_.-])gtins?($|[\s_.-])/gi,
    /eans$/i,
    /barcodes?$/i,
    /gtins?$/i,
  ],
  orders: [
    /(^|[\s_.-])purchase[\s_.-]*orders?($|[\s_.-])/gi,
    /(^|[\s_.-])orders?($|[\s_.-])/gi,
    /(^|[\s_.-])pos?($|[\s_.-])/gi,
    /purchaseorders?$/i,
    /orders$/i,
  ],
};

export function stripXlsxExtension(fileName: string): string {
  return fileName.replace(/\.xlsx$/i, "");
}

export function detectRoleFromFileName(fileName: string): FileRoleDetection {
  const stem = stripXlsxExtension(fileName).trim();

  for (const role of ROLE_ORDER) {
    if (hasRoleTerm(stem, role)) {
      return {
        role,
        baseName: removeRoleTerms(stem, role) || stem,
      };
    }
  }

  return { role: null, baseName: stem };
}

function hasRoleTerm(stem: string, role: FileRole): boolean {
  const normalized = normalizeHeaderText(stem);
  const tokens = normalized.split(/\s+/g).filter(Boolean);
  const compact = compactHeaderText(stem);
  const tokenTerms = TOKEN_ROLE_TERMS[role];

  return (
    tokens.some((token) => tokenTerms.has(token)) ||
    COMPACT_ROLE_TERMS[role].some((term) => compact.endsWith(term))
  );
}

function removeRoleTerms(stem: string, role: FileRole): string {
  let cleaned = stem;

  for (const pattern of ROLE_REMOVE_PATTERNS[role]) {
    cleaned = cleaned.replace(pattern, " ");
  }

  return cleaned.replace(/[\s_.-]+/g, "_").replace(/^_+|_+$/g, "");
}

export function deriveOutputFileName(ordersName: string, eansName: string): string {
  const orders = detectRoleFromFileName(ordersName);
  const eans = detectRoleFromFileName(eansName);
  const baseName =
    orders.baseName && orders.baseName === eans.baseName
      ? orders.baseName
      : orders.baseName || eans.baseName || "generated";

  return `${baseName}_urls.xlsx`;
}

export function isXlsxFileName(fileName: string): boolean {
  return /\.xlsx$/i.test(fileName);
}
