import type { FileRole } from "../scripts/urlGenerator/types";
import type { LocalWorkbookFile, RoleSelection } from "./types";

export const emptySelection: RoleSelection = {
  ordersId: "",
  eansId: "",
};

export function autoSelectRoles(
  files: LocalWorkbookFile[],
  current: RoleSelection,
): RoleSelection {
  const hasCurrentOrders = files.some((item) => item.id === current.ordersId);
  const hasCurrentEans = files.some((item) => item.id === current.eansId);
  const ordersId =
    hasCurrentOrders
      ? current.ordersId
      : files.find((item) => item.detectedRole === "orders")?.id ?? "";
  const eansId =
    hasCurrentEans
      ? current.eansId
      : files.find((item) => item.detectedRole === "eans")?.id ?? "";

  return {
    ordersId,
    eansId: eansId === ordersId ? "" : eansId,
  };
}

export function fileKey(file: File): string {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function roleLabel(role: FileRole): string {
  return role === "orders" ? "Orders" : "EAN/UPC";
}
