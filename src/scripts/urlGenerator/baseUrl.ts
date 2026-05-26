import { normalizeDataText } from "./headers";
import type { OrderRecord, ProcessingIssue } from "./types";

export function normalizeBaseUrl(url: string): string {
  return normalizeDataText(url).replace(/\/+$/g, "");
}

export function parseBaseUrl(order: OrderRecord):
  | { ok: true; baseUrl: string; issues: ProcessingIssue[] }
  | { ok: false; issue: ProcessingIssue } {
  const rawBaseUrl = normalizeDataText(order.base_url);

  try {
    const parsed = new URL(rawBaseUrl);

    if (parsed.protocol !== "https:") {
      return {
        ok: false,
        issue: {
          severity: "error",
          fileRole: "orders",
          rowNumber: order.sourceRowNumber,
          field: "base_url",
          message: "Base URL must start with https://.",
        },
      };
    }

    if (parsed.username || parsed.password) {
      return {
        ok: false,
        issue: {
          severity: "error",
          fileRole: "orders",
          rowNumber: order.sourceRowNumber,
          field: "base_url",
          message: "Base URL must not include a username or password.",
        },
      };
    }

    if (!isLikelyDomainName(parsed.hostname)) {
      return {
        ok: false,
        issue: {
          severity: "error",
          fileRole: "orders",
          rowNumber: order.sourceRowNumber,
          field: "base_url",
          message: "Base URL must use a domain like id.example.com.",
        },
      };
    }

    if (isTemplatePlaceholderDomain(parsed.hostname)) {
      return {
        ok: false,
        issue: {
          severity: "error",
          fileRole: "orders",
          rowNumber: order.sourceRowNumber,
          field: "base_url",
          message: "Base URL cannot use the template placeholder id.example.com.",
        },
      };
    }

    if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
      return {
        ok: false,
        issue: {
          severity: "error",
          fileRole: "orders",
          rowNumber: order.sourceRowNumber,
          field: "base_url",
          message:
            "Base URL must be an https root domain with only an optional trailing slash.",
        },
      };
    }

    if (parsed.hostname.toLowerCase().startsWith("www.")) {
      return {
        ok: false,
        issue: {
          severity: "error",
          fileRole: "orders",
          rowNumber: order.sourceRowNumber,
          field: "base_url",
          message: "Base URL must not include www.",
        },
      };
    }

    return {
      ok: true,
      baseUrl: serializeBaseUrl(parsed),
      issues: [],
    };
  } catch {
    return {
      ok: false,
      issue: {
        severity: "error",
        fileRole: "orders",
        rowNumber: order.sourceRowNumber,
        field: "base_url",
        message: "Base URL must be a valid URL like https://id.example.com.",
      },
    };
  }
}

export function formatGeneratedUrl(
  baseUrl: string,
  ean: string,
  purchaseOrder: string,
): string {
  return `${baseUrl}/01/${encodeUrlPathSegment(ean)}/10/${encodeUrlPathSegment(
    purchaseOrder,
  )}`;
}

function serializeBaseUrl(url: URL): string {
  return url.origin;
}

function isLikelyDomainName(hostname: string): boolean {
  const labels = hostname.toLowerCase().split(".");

  if (labels.length < 2) {
    return false;
  }

  return (
    labels.every(isValidDomainLabel) &&
    isValidTopLevelDomain(labels[labels.length - 1])
  );
}

function isTemplatePlaceholderDomain(hostname: string): boolean {
  return hostname.toLowerCase() === "id.example.com";
}

function isValidDomainLabel(label: string | undefined): boolean {
  return Boolean(
    label &&
      label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
  );
}

function isValidTopLevelDomain(label: string | undefined): boolean {
  return Boolean(
    label &&
      (/^[a-z]{2,63}$/.test(label) ||
        /^xn--[a-z0-9-]{2,59}$/.test(label)),
  );
}

function encodeUrlPathSegment(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
