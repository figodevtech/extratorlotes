import { fetchJson, extrairToken } from "./client";
import { montarUrlApi, suporteLeiloesConfig, type SuporteLeiloesConfig } from "./config";

export async function autenticarSuporteLeiloes(config: SuporteLeiloesConfig = suporteLeiloesConfig): Promise<string> {
  const { username, password, authPath, authMethod, bearerToken, origin } = config;

  if (bearerToken) {
    return bearerToken.replace(/^Bearer\s+/i, "");
  }

  if (!username || !password) {
    throw new Error(
      "Configure usuario e senha ou bearer token do cliente selecionado no .env.local.",
    );
  }

  const method = authMethod.toUpperCase();
  const body = new URLSearchParams({ user: username, pass: password }).toString();

  const payload = await fetchJson<unknown>(montarUrlApi(authPath, config), undefined, {
    method,
    headers:
      method === "GET"
        ? {
            ...(origin ? { Origin: origin, Referer: `${origin}/` } : {}),
          }
        : {
            "Content-Type": "application/x-www-form-urlencoded",
            ...(origin ? { Origin: origin, Referer: `${origin}/` } : {}),
          },
    body: method === "GET" ? undefined : body,
  }, config);

  const token = extrairToken(payload);
  if (!token) {
    throw new Error("Login realizado, mas a resposta não contém um token Bearer reconhecível.");
  }

  return token;
}
