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
        order_row_number: 3,
        ean_row_number: 2,
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
        order_row_number: 4,
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

  it("does not silently use positional fallback columns after detecting a header row", () => {
    const orders = extractOrders(
      [
        ["Purchase Order", "Product", "Notes"],
        ["1001", "P-100", "https://example.test/base"],
      ],
      ordersContext,
    );

    expect(orders.records).toHaveLength(0);
    expect(orders.detectedTable.columns.map((column) => column.key)).toEqual([
      "purchase_order",
      "product",
    ]);
    expect(orders.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          field: "base_url",
          message: 'Could not find required column "Base URL".',
        }),
      ]),
    );
  });

  it("validates base URLs before creating rows", () => {
    const output = buildUrls(
      [
        {
          purchase_order: "1001",
          product: "P1",
          base_url: "notaurl",
          sourceRowNumber: 2,
        },
        {
          purchase_order: "1002",
          product: "P1",
          base_url: "https://example.test/base?ref=1#top",
          sourceRowNumber: 3,
        },
      ],
      [{ product: "P1", ean: "1234567890123", sku: "", sourceRowNumber: 2 }],
      { outputOrder: "input" },
    );

    expect(output.urls.map((row) => row.url)).toEqual([
      "https://example.test/base/01/1234567890123/10/1002?ref=1#top",
    ]);
    expect(output.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "warning",
          rowNumber: 2,
          field: "base_url",
        }),
        expect.objectContaining({
          severity: "info",
          rowNumber: 3,
          field: "base_url",
        }),
      ]),
    );
  });

  it("can preserve source workbook order instead of sorted output order", () => {
    const orders = [
      {
        purchase_order: "1002",
        product: "B",
        base_url: "https://example.test",
        sourceRowNumber: 2,
      },
      {
        purchase_order: "1001",
        product: "A",
        base_url: "https://example.test",
        sourceRowNumber: 3,
      },
    ];
    const eans = [
      { product: "A", ean: "1111111111111", sku: "", sourceRowNumber: 2 },
      { product: "B", ean: "2222222222222", sku: "", sourceRowNumber: 3 },
    ];

    expect(buildUrls(orders, eans).urls.map((row) => row.product)).toEqual([
      "A",
      "B",
    ]);
    expect(
      buildUrls(orders, eans, { outputOrder: "input" }).urls.map(
        (row) => row.product,
      ),
    ).toEqual(["B", "A"]);
  });

  it("warns on unusual EAN lengths that may indicate lost leading zeroes", () => {
    const eans = extractEans(
      [
        ["Product", "EAN"],
        ["P1", "12345"],
      ],
      eansContext,
    );

    expect(eans.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "warning",
          rowNumber: 2,
          field: "ean",
        }),
      ]),
    );
  });
});
