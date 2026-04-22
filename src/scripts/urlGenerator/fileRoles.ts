import type { FileRole } from "./types";

export type NamedFile = {
  name: string;
};

export type FileRoleDetection = {
  role: FileRole | null;
  baseName: string;
};

const ROLE_PATTERNS: Record<FileRole, RegExp[]> = {
  eans: [
    /(?:^|[\s_-])eans?$/i,
    /(?:^|[\s_-])barcodes?$/i,
    /(?:^|[\s_-])gtins?$/i,
  ],
  orders: [
    /(?:^|[\s_-])orders?$/i,
    /(?:^|[\s_-])purchase[\s_-]?orders?$/i,
    /(?:^|[\s_-])pos?$/i,
  ],
};

export function stripXlsxExtension(fileName: string): string {
  return fileName.replace(/\.xlsx$/i, "");
}

export function detectRoleFromFileName(fileName: string): FileRoleDetection {
  const stem = stripXlsxExtension(fileName).trim();

  for (const [role, patterns] of Object.entries(ROLE_PATTERNS) as [
    FileRole,
    RegExp[],
  ][]) {
    for (const pattern of patterns) {
      if (pattern.test(stem)) {
        return {
          role,
          baseName: stem.replace(pattern, "").replace(/[\s_-]+$/g, "") || stem,
        };
      }
    }
  }

  return { role: null, baseName: stem };
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
