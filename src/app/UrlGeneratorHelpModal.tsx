import { X } from "lucide-react";

export function UrlGeneratorHelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        aria-labelledby="url-generator-help-title"
        aria-modal="true"
        className="help-modal"
        role="dialog"
      >
        <div className="help-modal-header">
          <div>
            <h2 id="url-generator-help-title">URL Generator help</h2>
            <p>Prepare two Excel workbooks, then Open Commander creates the output.</p>
          </div>
          <button
            aria-label="Close help"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={18} />
          </button>
        </div>

        <div className="help-sections">
          <section className="help-section">
            <h3>Orders workbook</h3>
            <ul>
              <li>Use one row for each purchase order and product.</li>
              <li>Required columns: purchase order, product, and base URL.</li>
              <li>Base URLs must be https root domains with no paths or query strings.</li>
            </ul>
          </section>
          <section className="help-section">
            <h3>EAN/UPC workbook</h3>
            <ul>
              <li>Use one row for each product identifier.</li>
              <li>Required column: product. Add EAN, UPC, mode, and SKU when available.</li>
              <li>Set mode to upc only when a row has only a UPC value.</li>
            </ul>
          </section>
          <section className="help-section">
            <h3>Matching rules</h3>
            <ul>
              <li>Product matching ignores case, spaces, dots, underscores, and hyphens.</li>
              <li>One purchase order can generate URLs for multiple matching identifiers.</li>
              <li>Duplicate purchase order/product, EAN, UPC, and SKU values are rejected.</li>
            </ul>
          </section>
          <section className="help-section">
            <h3>Output</h3>
            <ul>
              <li>The output workbook always includes urls and summary sheets.</li>
              <li>Unmatched orders and non-blocking issues are added as extra sheets when needed.</li>
              <li>Files stay in this browser and are not uploaded anywhere.</li>
            </ul>
          </section>
        </div>

        <div className="help-modal-actions">
          <a
            className="template-link"
            href="/templates/url-generator-orders-template.xlsx"
            download
          >
            Orders template
          </a>
          <a
            className="template-link"
            href="/templates/url-generator-eans-template.xlsx"
            download
          >
            EAN/UPC template
          </a>
        </div>
      </div>
    </div>
  );
}
