import { describe, expect, it } from "vitest";

import {
  buildUrls,
  extractEans,
  extractOrders,
} from "./transform";

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
        ["1001", "P-100", "https://example.test/"],
        ["1002", "P-200", "https://example.test"],
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
      "https://example.test/01/789/10/1001",
      "https://example.test/01/456/10/1002",
    ]);
    expect(orders.issues.some((issue) => issue.severity === "info")).toBe(true);
  });

  it("marks mandatory empty cells as errors", () => {
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
          severity: "error",
          rowNumber: 2,
          field: "product",
          message: 'Mandatory field "Product" is empty.',
        }),
        expect.objectContaining({
          severity: "error",
          message: "No usable data rows were found.",
        }),
      ]),
    );
  });

  it("strips leading Excel apostrophes from text values", () => {
    const orders = extractOrders(
      [
        ["purchase-order", "product", "base-url"],
        ["'PO 1", "'ABC-1", "'https://example.test/"],
      ],
      ordersContext,
    );
    const eans = extractEans(
      [
        ["product", "ean", "sku"],
        ["'abc 1", "'0123456789012", "'SKU-1"],
      ],
      eansContext,
    );

    const output = buildUrls(orders.records, eans.records);

    expect(orders.records[0]).toEqual(
      expect.objectContaining({
        purchase_order: "PO 1",
        product: "ABC-1",
        base_url: "https://example.test/",
      }),
    );
    expect(eans.records[0]).toEqual(
      expect.objectContaining({
        product: "abc 1",
        ean: "0123456789012",
        sku: "SKU-1",
      }),
    );
    expect(output.urls[0].url).toBe(
      "https://example.test/01/0123456789012/10/PO%201",
    );
  });

  it("flags duplicate EAN and SKU values", () => {
    const eans = extractEans(
      [
        ["Product", "EAN", "SKU"],
        ["P1", "1111111111111", "SKU-1"],
        ["P2", "1111111111111", "SKU-2"],
        ["P3", "2222222222222", "sku-1"],
      ],
      eansContext,
    );

    expect(eans.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          rowNumber: 3,
          field: "ean",
          message: 'Duplicate EAN "1111111111111" also appears on row 2.',
        }),
        expect.objectContaining({
          severity: "error",
          rowNumber: 4,
          field: "sku",
          message: 'Duplicate SKU "sku-1" also appears on row 2.',
        }),
      ]),
    );
  });

  it("flags duplicate purchase orders without caring about repeated products or URLs", () => {
    const orders = extractOrders(
      [
        ["Purchase Order", "Product", "Base URL"],
        ["1001", "P-1", "https://example.test/"],
        ["1001", "P-2", "https://example.test"],
        ["1002", "P-2", "https://example.test"],
      ],
      ordersContext,
    );

    expect(orders.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          rowNumber: 3,
          field: "purchase_order",
          message: 'Duplicate purchase order "1001" also appears on row 2.',
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

  it("requires base URLs to be https root domains", () => {
    const output = buildUrls(
      [
        {
          purchase_order: "1001",
          product: "P1",
          base_url: "https://example.com",
          sourceRowNumber: 2,
        },
        {
          purchase_order: "1002",
          product: "P1",
          base_url: "https://example.com/",
          sourceRowNumber: 3,
        },
        {
          purchase_order: "1003",
          product: "P1",
          base_url: "http://example.com",
          sourceRowNumber: 4,
        },
        {
          purchase_order: "1004",
          product: "P1",
          base_url: "https://example",
          sourceRowNumber: 5,
        },
        {
          purchase_order: "1005",
          product: "P1",
          base_url: "https://example.com/base",
          sourceRowNumber: 6,
        },
      ],
      [{ product: "P1", ean: "1234567890123", sku: "", sourceRowNumber: 2 }],
    );

    expect(output.urls.map((row) => row.url)).toEqual([
      "https://example.com/01/1234567890123/10/1001",
      "https://example.com/01/1234567890123/10/1002",
    ]);
    expect(output.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          rowNumber: 4,
          field: "base_url",
          message: "Base URL must start with https://.",
        }),
        expect.objectContaining({
          severity: "error",
          rowNumber: 5,
          field: "base_url",
          message: "Base URL must use a domain like example.com.",
        }),
        expect.objectContaining({
          severity: "error",
          rowNumber: 6,
          field: "base_url",
          message:
            "Base URL must be an https root domain with only an optional trailing slash.",
        }),
      ]),
    );
  });

  it("warns when a base URL uses www but still creates the URL", () => {
    const output = buildUrls(
      [
        {
          purchase_order: "1001",
          product: "P1",
          base_url: "https://www.example.com/",
          sourceRowNumber: 2,
        },
      ],
      [{ product: "P1", ean: "1234567890123", sku: "", sourceRowNumber: 2 }],
    );

    expect(output.urls.map((row) => row.url)).toEqual([
      "https://www.example.com/01/1234567890123/10/1001",
    ]);
    expect(output.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "warning",
          rowNumber: 2,
          field: "base_url",
          message: "Base URL includes www. Prefer the domain without www.",
        }),
      ]),
    );
  });

  it("validates base URLs even when the product is unmatched", () => {
    const output = buildUrls(
      [
        {
          purchase_order: "1001",
          product: "missing",
          base_url: "https://example",
          sourceRowNumber: 2,
        },
      ],
      [{ product: "P1", ean: "1234567890123", sku: "", sourceRowNumber: 2 }],
    );

    expect(output.unmatchedOrders).toEqual([]);
    expect(output.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          rowNumber: 2,
          field: "base_url",
          message: "Base URL must use a domain like example.com.",
        }),
      ]),
    );
  });

  it("always sorts by purchase order, product, then SKU", () => {
    const orders = [
      {
        purchase_order: "1002",
        product: "B",
        base_url: "https://example.test",
        sourceRowNumber: 2,
      },
      {
        purchase_order: "1001",
        product: "B",
        base_url: "https://example.test",
        sourceRowNumber: 3,
      },
      {
        purchase_order: "1003",
        product: "A",
        base_url: "https://example.test",
        sourceRowNumber: 4,
      },
    ];
    const eans = [
      { product: "B", ean: "2222222222222", sku: "S-2", sourceRowNumber: 2 },
      { product: "A", ean: "1111111111111", sku: "", sourceRowNumber: 3 },
      { product: "B", ean: "3333333333333", sku: "S-1", sourceRowNumber: 4 },
    ];

    expect(
      buildUrls(orders, eans).urls.map((row) => [
        row.purchase_order,
        row.product,
        row.sku,
      ]),
    ).toEqual([
      ["1001", "B", "S-1"],
      ["1001", "B", "S-2"],
      ["1002", "B", "S-1"],
      ["1002", "B", "S-2"],
      ["1003", "A", ""],
    ]);
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
