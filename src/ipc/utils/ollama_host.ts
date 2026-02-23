const OLLAMA_DEFAULT_HOST = "http://localhost:11434";
const OLLAMA_DEFAULT_PORT = "11434";

function toUrlWithDefaultPort(value: string): string {
  if (value.startsWith("[")) {
    // Bracketed IPv6 host, optionally with explicit port.
    return value.includes("]:")
      ? `http://${value}`
      : `http://${value}:${OLLAMA_DEFAULT_PORT}`;
  }

  const colonCount = (value.match(/:/g) ?? []).length;
  const hasSinglePortSuffix = colonCount === 1 && /:\d+$/.test(value);

  if (colonCount > 1 && !hasSinglePortSuffix) {
    return `http://[${value}]:${OLLAMA_DEFAULT_PORT}`;
  }

  const hasExplicitPort = hasSinglePortSuffix;
  return hasExplicitPort
    ? `http://${value}`
    : `http://${value}:${OLLAMA_DEFAULT_PORT}`;
}

export function parseOllamaHost(host?: string): string {
  const value = host?.trim();
  if (!value) {
    return OLLAMA_DEFAULT_HOST;
  }

  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }

  return toUrlWithDefaultPort(value);
}

export function getOllamaApiUrl(): string {
  return parseOllamaHost(
    process.env.OLLAMA_HOST_FOR_TESTING || process.env.OLLAMA_HOST,
  );
}
