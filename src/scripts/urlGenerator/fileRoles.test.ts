import { describe, expect, it } from "vitest";

import { deriveOutputFileName, detectRoleFromFileName } from "./fileRoles";

describe("URL generator file role detection", () => {
  it("detects roles with flexible file naming", () => {
    expect(detectRoleFromFileName("SPRING_purchase-orders.xlsx")).toMatchObject({
      role: "orders",
      baseName: "SPRING",
    });
    expect(detectRoleFromFileName("spring.eans.xlsx")).toMatchObject({
      role: "eans",
      baseName: "spring",
    });
    expect(detectRoleFromFileName("barcodes_spring.xlsx")).toMatchObject({
      role: "eans",
      baseName: "spring",
    });
  });

  it("derives matching output names after removing role words", () => {
    expect(
      deriveOutputFileName("spring-purchase-orders.xlsx", "spring_eans.xlsx"),
    ).toBe("spring_urls.xlsx");
  });
});
