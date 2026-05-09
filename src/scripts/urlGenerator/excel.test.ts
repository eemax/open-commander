import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { FatalInputIssueError, runUrlGenerator } from "./excel";

describe("URL generator workbook runner", () => {
  it("reads two xlsx buffers and writes a downloadable workbook", async () => {
    const ordersBuffer = await createWorkbookBuffer([
      ["Purchase Order", "Product Code", "Base URL"],
      ["PO 100", "ABC-1", "https://example.test/"],
    ]);
    const eansBuffer = await createWorkbookBuffer([
      ["Product", "EAN", "SKU"],
      ["abc 1", "1234567890123", "SKU-1"],
    ]);

    const result = await runUrlGenerator([
      {
        role: "orders",
        fileName: "spring_orders.xlsx",
        buffer: ordersBuffer,
      },
      {
        role: "eans",
        fileName: "spring_eans.xlsx",
        buffer: eansBuffer,
      },
    ]);

    const outputWorkbook = new ExcelJS.Workbook();
    await outputWorkbook.xlsx.load(result.outputBuffer);
    const urlsSheet = outputWorkbook.getWorksheet("urls");
    const summaryRows = readWorksheetRows(outputWorkbook.getWorksheet("summary"));

    expect(result.outputFileName).toBe("spring_urls.xlsx");
    expect(result.stats.urlsCreated).toBe(1);
    expect(result.previewRows).toEqual([
      expect.objectContaining({
        purchase_order: "PO 100",
        product: "ABC-1",
        sku: "SKU-1",
        ean: "1234567890123",
        url: "https://example.test/01/1234567890123/10/PO%20100",
      }),
    ]);
    expect(urlsSheet?.getRow(1).values).toEqual([
      undefined,
      "purchase_order",
      "product",
      "sku",
      "ean",
      "base_url",
      "url",
      "order_row_number",
      "ean_row_number",
    ]);
    expect(urlsSheet?.getCell("A2").value).toBe("PO 100");
    expect(urlsSheet?.getCell("G2").value).toBe(2);
    expect(urlsSheet?.getCell("H2").value).toBe(2);
    expect(urlsSheet?.getCell("F2").value).toBe(
      "https://example.test/01/1234567890123/10/PO%20100",
    );
    expect(summaryRows[0]).toEqual(["section", "item", "value", "detail"]);
    expect(summaryRows).toEqual(
      expect.arrayContaining([
        [
          "Run overview",
          "URL format",
          "{base_url}/01/{ean}/10/{purchase_order}",
          expect.stringContaining("URL path encoded"),
        ],
        [
          "Results",
          "URLs created",
          1,
          expect.stringContaining("urls sheet"),
        ],
        [
          "Source tables",
          "Orders workbook",
          "spring_orders.xlsx",
          expect.stringContaining("Purchase Order -> purchase_order"),
        ],
        [
          "Detected headers",
          "Orders column A",
          "Purchase Order",
          "Resolved to purchase_order (Purchase order).",
        ],
        [
          "Detected headers",
          "EANs column C",
          "SKU",
          "Resolved to sku (SKU).",
        ],
      ]),
    );
    expect(summaryRows.map((row) => row[0])).not.toContain("Accepted headers");
    expect(summaryRows.map((row) => row[0])).not.toContain("Validation");
    expect(summaryRows.map((row) => row[0])).not.toContain("Input issues");
  });

  it("preserves simple zero-padded numeric identifier formats", async () => {
    const ordersBuffer = await createWorkbookBuffer([
      ["Purchase Order", "Product Code", "Base URL"],
      ["PO 100", "ABC-1", "https://example.test/"],
    ]);
    const eansBuffer = await createWorkbookBuffer([
      ["Product", "EAN", "SKU"],
      [
        "abc 1",
        { value: 123456789012, numFmt: "0000000000000" },
        "SKU-1",
      ],
    ]);

    const result = await runUrlGenerator([
      {
        role: "orders",
        fileName: "spring_orders.xlsx",
        buffer: ordersBuffer,
      },
      {
        role: "eans",
        fileName: "spring_eans.xlsx",
        buffer: eansBuffer,
      },
    ]);

    const outputWorkbook = new ExcelJS.Workbook();
    await outputWorkbook.xlsx.load(result.outputBuffer);
    const urlsSheet = outputWorkbook.getWorksheet("urls");

    expect(urlsSheet?.getCell("D2").value).toBe("0123456789012");
    expect(urlsSheet?.getCell("F2").value).toBe(
      "https://example.test/01/0123456789012/10/PO%20100",
    );
  });

  it("fails the run when mandatory cells are empty", async () => {
    const ordersBuffer = await createWorkbookBuffer([
      ["Purchase Order", "Product Code", "Base URL"],
      ["", "ABC-1", "https://example.test/"],
    ]);
    const eansBuffer = await createWorkbookBuffer([
      ["Product", "EAN", "SKU"],
      ["abc 1", "1234567890123", ""],
    ]);

    const runPromise = runUrlGenerator([
      {
        role: "orders",
        fileName: "spring_orders.xlsx",
        buffer: ordersBuffer,
      },
      {
        role: "eans",
        fileName: "spring_eans.xlsx",
        buffer: eansBuffer,
      },
    ]);

    await expect(runPromise).rejects.toBeInstanceOf(FatalInputIssueError);
    await expect(runPromise).rejects.toThrow(
      'Mandatory field "Purchase order" is empty.',
    );
    await expect(runPromise).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          rowNumber: 2,
          field: "purchase_order",
          message: 'Mandatory field "Purchase order" is empty.',
        }),
      ]),
    });
  });

  it("fails the run when purchase order and product combinations are duplicated", async () => {
    const ordersBuffer = await createWorkbookBuffer([
      ["Purchase Order", "Product Code", "Base URL"],
      ["PO 100", "ABC-1", "https://example.test/"],
      ["po 100", "abc 1", "https://example.test/"],
    ]);
    const eansBuffer = await createWorkbookBuffer([
      ["Product", "EAN", "SKU"],
      ["abc 1", "1234567890123", "SKU-1"],
    ]);

    await expect(
      runUrlGenerator([
        {
          role: "orders",
          fileName: "spring_orders.xlsx",
          buffer: ordersBuffer,
        },
        {
          role: "eans",
          fileName: "spring_eans.xlsx",
          buffer: eansBuffer,
        },
      ]),
    ).rejects.toThrow(
      'Duplicate purchase order/product combination "po 100" + "abc 1"',
    );
  });

  it("allows one purchase order to contain multiple products", async () => {
    const ordersBuffer = await createWorkbookBuffer([
      ["Purchase Order", "Product Code", "Base URL"],
      ["PO 100", "ABC-1", "https://example.test/"],
      ["PO 100", "XYZ-9", "https://example.test/"],
    ]);
    const eansBuffer = await createWorkbookBuffer([
      ["Product", "EAN", "SKU"],
      ["abc 1", "1234567890123", "SKU-1"],
      ["xyz 9", "2222222222222", "SKU-2"],
    ]);

    const result = await runUrlGenerator([
      {
        role: "orders",
        fileName: "spring_orders.xlsx",
        buffer: ordersBuffer,
      },
      {
        role: "eans",
        fileName: "spring_eans.xlsx",
        buffer: eansBuffer,
      },
    ]);

    const outputWorkbook = new ExcelJS.Workbook();
    await outputWorkbook.xlsx.load(result.outputBuffer);
    const urlsSheet = outputWorkbook.getWorksheet("urls");

    expect(result.stats.urlsCreated).toBe(2);
    expect(urlsSheet?.getCell("F2").value).toBe(
      "https://example.test/01/1234567890123/10/PO%20100",
    );
    expect(urlsSheet?.getCell("F3").value).toBe(
      "https://example.test/01/2222222222222/10/PO%20100",
    );
  });

  it("fails the run when a base URL is not an https root domain", async () => {
    const ordersBuffer = await createWorkbookBuffer([
      ["Purchase Order", "Product Code", "Base URL"],
      ["PO 100", "ABC-1", "https://example.test/path"],
    ]);
    const eansBuffer = await createWorkbookBuffer([
      ["Product", "EAN", "SKU"],
      ["abc 1", "1234567890123", "SKU-1"],
    ]);

    await expect(
      runUrlGenerator([
        {
          role: "orders",
          fileName: "spring_orders.xlsx",
          buffer: ordersBuffer,
        },
        {
          role: "eans",
          fileName: "spring_eans.xlsx",
          buffer: eansBuffer,
        },
      ]),
    ).rejects.toThrow(
      "Base URL must be an https root domain with only an optional trailing slash.",
    );
  });

  it("rejects base URLs that contain www", async () => {
    const ordersBuffer = await createWorkbookBuffer([
      ["Purchase Order", "Product Code", "Base URL"],
      ["PO 100", "ABC-1", "https://www.example.test/"],
    ]);
    const eansBuffer = await createWorkbookBuffer([
      ["Product", "EAN", "SKU"],
      ["abc 1", "1234567890123", "SKU-1"],
    ]);

    await expect(
      runUrlGenerator([
        {
          role: "orders",
          fileName: "spring_orders.xlsx",
          buffer: ordersBuffer,
        },
        {
          role: "eans",
          fileName: "spring_eans.xlsx",
          buffer: eansBuffer,
        },
      ]),
    ).rejects.toThrow("Base URL must not include www.");
  });
});

type CellInput = string | number | { value: string | number; numFmt?: string };

async function createWorkbookBuffer(rows: CellInput[][]): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");

  rows.forEach((row) => {
    const worksheetRow = sheet.addRow(
      row.map((cell) => (typeof cell === "object" ? cell.value : cell)),
    );

    row.forEach((cell, index) => {
      if (typeof cell === "object" && cell.numFmt) {
        worksheetRow.getCell(index + 1).numFmt = cell.numFmt;
      }
    });
  });

  const value = (await workbook.xlsx.writeBuffer()) as ArrayBuffer | Uint8Array;

  if (value instanceof ArrayBuffer) {
    return value;
  }

  return value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength,
  ) as ArrayBuffer;
}

function readWorksheetRows(worksheet: ExcelJS.Worksheet | undefined): unknown[][] {
  expect(worksheet).toBeDefined();

  const rows: unknown[][] = [];

  worksheet?.eachRow((row) => {
    rows.push((row.values as unknown[]).slice(1));
  });

  return rows;
}
