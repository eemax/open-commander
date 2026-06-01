import { describe, expect, it } from "vitest";

import {
  buildUrls,
  extractEans,
  extractOrders,
} from "./transform";
import type { EanRecord } from "./types";

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

function identifierRecord(input: {
  product: string;
  ean?: string;
  upc?: string;
  sku?: string;
  mode?: EanRecord["mode"];
  sourceRowNumber: number;
}): EanRecord {
  const mode = input.mode ?? "ean";
  const identifierType = mode === "ean" ? "ean" : "upc";
  const ean = input.ean ?? "";
  const upc = input.upc ?? "";

  return {
    product: input.product,
    ean,
    upc,
    sku: input.sku ?? "",
    mode,
    identifier_type: identifierType,
    identifier: identifierType === "ean" ? ean : upc,
    sourceRowNumber: input.sourceRowNumber,
  };
}

describe("URL generator transform", () => {
  it("detects flexible headers and creates encoded URL rows", () => {
    const orders = extractOrders(
      [
        ["Exported from shop system", "", ""],
        ["Batch-Number", "STYLE_NUMBER", " Website "],
        ["PO 1", "ABC-123", "https://example.test/"],
        ["PO/2", "missing", "https://example.test"],
      ],
      ordersContext,
    );
    const eans = extractEans(
      [
        ["style-number", "Barcode", "Variant SKU"],
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
        identifier_row_number: 2,
        purchase_order: "PO 1",
        product: "ABC-123",
        base_url: "https://example.test",
        identifier_type: "ean",
        identifier: "0001112223334",
        ean: "0001112223334",
        upc: "",
        mode: "ean",
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

  it("does not accept SKU as a product header", () => {
    const eans = extractEans(
      [
        ["SKU", "EAN", "Variant SKU"],
        ["ABC-123", "0001112223334", "S-1"],
      ],
      eansContext,
    );

    expect(eans.records).toHaveLength(0);
    expect(eans.detectedTable.headerRowNumber).toBe(1);
    expect(eans.detectedTable.columns.map((column) => column.key)).toEqual([
      "ean",
      "sku",
    ]);
    expect(eans.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          field: "product",
          message: 'Add a "Product" column.',
        }),
      ]),
    );
  });

  it("fails when no recognizable header row exists", () => {
    const orders = extractOrders(
      [
        ["1001", "P-100", "https://example.test/"],
        ["1002", "P-200", "https://example.test"],
      ],
      ordersContext,
    );

    expect(orders.detectedTable.headerRowNumber).toBeNull();
    expect(orders.detectedTable.columns).toEqual([]);
    expect(orders.records).toHaveLength(0);
    expect(orders.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          message: "Add a header row with the required columns.",
        }),
        expect.objectContaining({
          severity: "error",
          field: "purchase_order",
          message: 'Add a "Purchase order" column.',
        }),
        expect.objectContaining({
          severity: "error",
          field: "product",
          message: 'Add a "Product" column.',
        }),
        expect.objectContaining({
          severity: "error",
          field: "base_url",
          message: 'Add a "Base URL" column.',
        }),
      ]),
    );
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
          message: 'Add a product value.',
        }),
        expect.objectContaining({
          severity: "error",
          message: "Add at least one complete data row.",
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

  it("flags duplicate EAN, UPC, and SKU values", () => {
    const eans = extractEans(
      [
        ["Product", "EAN", "UPC", "Mode", "SKU"],
        ["P1", "1111111111111", "999999999999", "upc", "SKU-1"],
        ["P2", "1111111111111", "888888888888", "upc", "SKU-2"],
        ["P3", "2222222222222", "999999999999", "upc", "SKU-3"],
        ["P4", "3333333333333", "777777777777", "upc", "sku-1"],
      ],
      eansContext,
    );

    expect(eans.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          rowNumber: 3,
          field: "ean",
          message: 'Duplicate of row 2. Make this EAN unique.',
        }),
        expect.objectContaining({
          severity: "error",
          rowNumber: 4,
          field: "upc",
          message: 'Duplicate of row 2. Make this UPC unique.',
        }),
        expect.objectContaining({
          severity: "error",
          rowNumber: 5,
          field: "sku",
          message: 'Duplicate of row 2. Make this SKU unique.',
        }),
      ]),
    );
  });

  it("does not resolve GTIN as an identifier header", () => {
    const eans = extractEans(
      [
        ["Product", "GTIN"],
        ["P1", "1234567890123"],
      ],
      eansContext,
    );

    expect(eans.records).toHaveLength(0);
    expect(eans.detectedTable.headerRowNumber).toBeNull();
    expect(eans.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          message: "Add a header row with the required columns.",
        }),
      ]),
    );
  });

  it("resolves EAN and UPC modes row by row", () => {
    const eans = extractEans(
      [
        ["Product", "EAN", "UPC", "Mode", "SKU"],
        ["P1", "1111111111111", "111111111111", "", "SKU-1"],
        ["P2", "2222222222222", "222222222222", "upc", "SKU-2"],
        ["P3", "3333333333333", "333333333333", "upc only", "SKU-3"],
        ["P4", "", "444444444444", "upc only", "SKU-4"],
      ],
      eansContext,
    );

    expect(eans.records.map((record) => [
      record.product,
      record.mode,
      record.identifier_type,
      record.identifier,
    ])).toEqual([
      ["P1", "ean", "ean", "1111111111111"],
      ["P2", "upc", "upc", "222222222222"],
      ["P3", "upc_only", "upc", "333333333333"],
      ["P4", "upc_only", "upc", "444444444444"],
    ]);
    expect(eans.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "warning",
          rowNumber: 4,
          field: "mode",
          message: 'EAN will be ignored because mode is "upc only".',
        }),
      ]),
    );
  });

  it("requires explicit UPC-only mode when only UPC exists", () => {
    const eans = extractEans(
      [
        ["Product", "UPC"],
        ["P1", "111111111111"],
      ],
      eansContext,
    );

    expect(eans.records).toHaveLength(0);
    expect(eans.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          rowNumber: 2,
          field: "mode",
          message: 'Set mode to "upc only" when only UPC is present.',
        }),
      ]),
    );
  });

  it("creates UPC URLs when UPC mode is explicit", () => {
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
        identifierRecord({
          product: "P1",
          ean: "1234567890123",
          upc: "123456789012",
          mode: "upc",
          sourceRowNumber: 2,
        }),
      ],
    );

    expect(output.urls[0]).toEqual(
      expect.objectContaining({
        identifier_type: "upc",
        identifier: "123456789012",
        ean: "1234567890123",
        upc: "123456789012",
        mode: "upc",
        url: "https://example.test/01/123456789012/10/1001",
      }),
    );
  });

  it("validates explicit UPC and invalid mode values", () => {
    const eans = extractEans(
      [
        ["Product", "EAN", "UPC", "Mode"],
        ["P1", "1111111111111", "", "upc"],
        ["P2", "", "222222222222", "upc"],
        ["P3", "3333333333333", "333333333333", "gtin"],
      ],
      eansContext,
    );

    expect(eans.records).toHaveLength(0);
    expect(eans.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          rowNumber: 2,
          field: "mode",
          message: "UPC mode needs both EAN and UPC values.",
        }),
        expect.objectContaining({
          severity: "error",
          rowNumber: 3,
          field: "mode",
          message: "UPC mode needs both EAN and UPC values.",
        }),
        expect.objectContaining({
          severity: "error",
          rowNumber: 4,
          field: "mode",
          message: 'Use "ean", "upc", or "upc only".',
        }),
      ]),
    );
  });

  it("flags duplicate purchase order and product combinations", () => {
    const orders = extractOrders(
      [
        ["Purchase Order", "Product", "Base URL"],
        ["1001", "P-1", "https://example.test/"],
        ["1001", "P-2", "https://example.test"],
        ["1001", "p 1", "https://example.test"],
      ],
      ordersContext,
    );

    expect(orders.records).toHaveLength(3);
    expect(orders.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          rowNumber: 4,
          field: "purchase_order",
          message:
            'Duplicate of row 2. Make this purchase order/product pair unique.',
        }),
      ]),
    );
  });

  it("does not silently read missing required columns from data rows", () => {
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
          message: 'Add a "Base URL" column.',
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
          base_url: "https://brand.com",
          sourceRowNumber: 2,
        },
        {
          purchase_order: "1002",
          product: "P1",
          base_url: "https://brand.com/",
          sourceRowNumber: 3,
        },
        {
          purchase_order: "1003",
          product: "P1",
          base_url: "http://brand.com",
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
          base_url: "https://brand.com/base",
          sourceRowNumber: 6,
        },
      ],
      [identifierRecord({ product: "P1", ean: "1234567890123", sourceRowNumber: 2 })],
    );

    expect(output.urls.map((row) => row.url)).toEqual([
      "https://brand.com/01/1234567890123/10/1001",
      "https://brand.com/01/1234567890123/10/1002",
    ]);
    expect(output.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          rowNumber: 4,
          field: "base_url",
          message: "Start with https://.",
        }),
        expect.objectContaining({
          severity: "error",
          rowNumber: 5,
          field: "base_url",
          message: "Use a domain like https://id.yourdomain.com.",
        }),
        expect.objectContaining({
          severity: "error",
          rowNumber: 6,
          field: "base_url",
          message:
            "Use only the root domain, like https://id.yourdomain.com.",
        }),
      ]),
    );
  });

  it("rejects the id.example.com template placeholder", () => {
    const output = buildUrls(
      [
        {
          purchase_order: "1001",
          product: "P1",
          base_url: "https://id.example.com",
          sourceRowNumber: 2,
        },
        {
          purchase_order: "1002",
          product: "P1",
          base_url: "https://example.com/",
          sourceRowNumber: 3,
        },
      ],
      [identifierRecord({ product: "P1", ean: "1234567890123", sourceRowNumber: 2 })],
    );

    expect(output.urls.map((row) => row.url)).toEqual([
      "https://example.com/01/1234567890123/10/1002",
    ]);
    expect(output.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          rowNumber: 2,
          field: "base_url",
          message: "Replace the template placeholder id.example.com.",
        }),
      ]),
    );
  });

  it("rejects base URLs that include www", () => {
    const output = buildUrls(
      [
        {
          purchase_order: "1001",
          product: "P1",
          base_url: "https://www.brand.com/",
          sourceRowNumber: 2,
        },
      ],
      [identifierRecord({ product: "P1", ean: "1234567890123", sourceRowNumber: 2 })],
    );

    expect(output.urls).toEqual([]);
    expect(output.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          rowNumber: 2,
          field: "base_url",
          message: "Remove www. from the domain.",
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
      [identifierRecord({ product: "P1", ean: "1234567890123", sourceRowNumber: 2 })],
    );

    expect(output.unmatchedOrders).toEqual([]);
    expect(output.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          rowNumber: 2,
          field: "base_url",
          message: "Use a domain like https://id.yourdomain.com.",
        }),
      ]),
    );
  });

  it("always sorts by purchase order, product, then SKU", () => {
    const orders = [
      {
        purchase_order: "1001",
        product: "A",
        base_url: "https://example.test",
        sourceRowNumber: 5,
      },
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
      identifierRecord({
        product: "B",
        ean: "2222222222222",
        sku: "S-2",
        sourceRowNumber: 2,
      }),
      identifierRecord({ product: "A", ean: "1111111111111", sourceRowNumber: 3 }),
      identifierRecord({
        product: "B",
        ean: "3333333333333",
        sku: "S-1",
        sourceRowNumber: 4,
      }),
    ];

    expect(
      buildUrls(orders, eans).urls.map((row) => [
        row.purchase_order,
        row.product,
        row.sku,
      ]),
    ).toEqual([
      ["1001", "A", ""],
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
