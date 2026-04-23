import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { runUrlGenerator } from "./excel";

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

    expect(result.outputFileName).toBe("spring_urls.xlsx");
    expect(result.stats.urlsCreated).toBe(1);
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
    ).rejects.toThrow('Mandatory field "Purchase order" is empty.');
  });

  it("fails the run when unique identifiers are duplicated", async () => {
    const ordersBuffer = await createWorkbookBuffer([
      ["Purchase Order", "Product Code", "Base URL"],
      ["PO 100", "ABC-1", "https://example.test/"],
      ["PO 100", "XYZ-9", "https://example.test/"],
    ]);
    const eansBuffer = await createWorkbookBuffer([
      ["Product", "EAN", "SKU"],
      ["abc 1", "1234567890123", "SKU-1"],
      ["xyz 9", "1234567890123", "SKU-2"],
      ["other", "2222222222222", "sku-1"],
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
    ).rejects.toThrow('Duplicate purchase order "PO 100"');
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

  it("warns but completes when the base URL contains www", async () => {
    const ordersBuffer = await createWorkbookBuffer([
      ["Purchase Order", "Product Code", "Base URL"],
      ["PO 100", "ABC-1", "https://www.example.test/"],
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

    expect(result.stats.urlsCreated).toBe(1);
    expect(result.issues).toEqual(
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
