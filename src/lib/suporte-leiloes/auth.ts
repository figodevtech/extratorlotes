import { fetchJson, extrairToken } from "./client";
import { montarUrlApi, suporteLeiloesConfig } from "./config";

export async function autenticarSuporteLeiloes(): Promise<string> {
  const { username, password, authPath, authMethod, bearerToken, origin } = suporteLeiloesConfig;

  if (bearerToken) {
    return bearerToken.replace(/^Bearer\s+/i, "");
  }

  if (!username || !password) {
    throw new Error(
      "Configure SUPORTE_LEILOES_USERNAME e SUPORTE_LEILOES_PASSWORD ou SUPORTE_LEILOES_BEARER_TOKEN no .env.local.",
    );
  }

  const method = authMethod.toUpperCase();
  const body = new URLSearchParams({ user: username, pass: password }).toString();

  const payload = await fetchJson<unknown>(montarUrlApi(authPath), undefined, {
    method,
    headers:
      method === "GET"
        ? {
            Origin: origin,
            Referer: `${origin}/`,
          }
        : {
            "Content-Type": "application/x-www-form-urlencoded",
            Origin: origin,
            Referer: `${origin}/`,
          },
    body: method === "GET" ? undefined : body,
  });

  const token = extrairToken(payload);
  if (!token) {
    throw new Error("Login realizado, mas a resposta não contém um token Bearer reconhecível.");
  }

  return token;
}
