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
    expect(urlsSheet?.getCell("A2").value).toBe(2);
    expect(urlsSheet?.getCell("B2").value).toBe(2);
    expect(urlsSheet?.getCell("H2").value).toBe(
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

    expect(urlsSheet?.getCell("F2").value).toBe("0123456789012");
    expect(urlsSheet?.getCell("H2").value).toBe(
      "https://example.test/01/0123456789012/10/PO%20100",
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
