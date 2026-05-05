export function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") {
    return file.arrayBuffer();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => {
      reject(reader.error ?? new Error(`Could not read ${file.name}.`));
    };
    reader.onabort = () => {
      reject(new DOMException(`Reading ${file.name} was canceled.`, "AbortError"));
    };
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
        return;
      }

      reject(new Error(`Could not read ${file.name} as a workbook buffer.`));
    };

    reader.readAsArrayBuffer(file);
  });
}
