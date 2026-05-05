let fallbackIdCounter = 0;

export function createLocalId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  fallbackIdCounter += 1;

  return [
    "local",
    Date.now().toString(36),
    fallbackIdCounter.toString(36),
    randomIdPart(),
  ].join("-");
}

function randomIdPart(): string {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const values = new Uint32Array(2);
    crypto.getRandomValues(values);

    return Array.from(values, (value) => value.toString(36)).join("");
  }

  return Math.random().toString(36).slice(2);
}
