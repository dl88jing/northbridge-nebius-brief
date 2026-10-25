/** Ensure tests never touch real keys or the network. */
export function clearKeys() {
  for (const k of ["NEBIUS_API_KEY", "NEBIUS_TOKEN_FACTORY_API_KEY", "TOKEN_FACTORY_API_KEY", "TAVILY_API_KEY"]) delete process.env[k];
}
