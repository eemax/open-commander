import { describe, expect, it } from "vitest";

import { buildUrls, extractEans, extractOrders } from "./transform";

const ordersContext = {
  fileRole: "orders" as const,
  fileName: "winter_orders.xlsx",
  sheetName: "Orders",
};

const eansContext = {
  fileRole: "eans" as const,
  fileName: "winter_eans.xlsx",
  sheetName: "EANs",
};

describe("URL generator transform", () => {
  it("detects flexible headers and creates encoded URL rows", () => {
    const orders = extractOrders(
      [
        ["Exported from shop system", "", ""],
        ["Purchase Order #", "PRODUCT-CODE", " Base URL "],
        ["PO 1", "ABC-123", "https://example.test/"],
        ["PO/2", "missing", "https://example.test"],
      ],
      ordersContext,
    );
    const eans = extractEans(
      [
        ["SKU", "Barcode", "Variant SKU"],
        ["abc 123", "0001112223334", "S-1"],
      ],
      eansContext,
    );

    const output = buildUrls(orders.records, eans.records);

    expect(orders.detectedTable.headerRowNumber).toBe(2);
    expect(eans.detectedTable.columns.map((column) => column.columnName)).toEqual([
      "A",
      "B",
      "C",
    ]);
    expect(output.urls).toEqual([
      {
        purchase_order: "PO 1",
        product: "ABC-123",
        base_url: "https://example.test",
        ean: "0001112223334",
        sku: "S-1",
        url: "https://example.test/01/0001112223334/10/PO%201",
      },
    ]);
    expect(output.unmatchedOrders).toEqual([
      {
        purchase_order: "PO/2",
        product: "missing",
        base_url: "https://example.test",
      },
    ]);
  });

  it("uses positional columns without dropping the first data row when no header exists", () => {
    const orders = extractOrders(
      [
        ["1001", "P-100", "https://example.test/base/"],
        ["1002", "P-200", "https://example.test/base"],
      ],
      ordersContext,
    );
    const eans = extractEans(
      [
        ["P100", "789"],
        ["P-200", "456", "SKU-456"],
      ],
      eansContext,
    );

    const output = buildUrls(orders.records, eans.records);

    expect(orders.detectedTable.headerRowNumber).toBeNull();
    expect(orders.records).toHaveLength(2);
    expect(output.urls.map((row) => row.url)).toEqual([
      "https://example.test/base/01/789/10/1001",
      "https://example.test/base/01/456/10/1002",
    ]);
    expect(orders.issues.some((issue) => issue.severity === "info")).toBe(true);
  });

  it("skips incomplete rows and reports them as input issues", () => {
    const orders = extractOrders(
      [
        ["purchase order", "product", "base url"],
        ["1001", "", "https://example.test"],
      ],
      ordersContext,
    );

    expect(orders.records).toHaveLength(0);
    expect(orders.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "warning",
          rowNumber: 2,
          field: "product",
        }),
        expect.objectContaining({
          severity: "error",
          message: "No usable data rows were found.",
        }),
      ]),
    );
  });

  it("deduplicates repeated EAN rows before creating URLs", () => {
    const output = buildUrls(
      [
        {
          purchase_order: "1001",
          product: "P1",
          base_url: "https://example.test",
          sourceRowNumber: 2,
        },
      ],
      [
        { product: "P1", ean: "111", sku: "A", sourceRowNumber: 2 },
        { product: "p1", ean: "111", sku: "A", sourceRowNumber: 3 },
      ],
    );

    expect(output.urls).toHaveLength(1);
    expect(output.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "info",
          message: "1 duplicate EAN row skipped.",
        }),
      ]),
    );
  });
});
