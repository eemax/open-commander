export function downloadArrayBuffer(
  buffer: ArrayBuffer,
  fileName: string,
  mimeType: string,
): void {
  const url = URL.createObjectURL(new Blob([buffer], { type: mimeType }));
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
