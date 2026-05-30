import { suporteLeiloesConfig } from "./config";

export async function fetchJson<T>(url: string, token?: string, init?: RequestInit): Promise<T> {
  const originHeaders = {
    Origin: suporteLeiloesConfig.origin,
    Referer: `${suporteLeiloesConfig.origin}/`,
  };

  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...originHeaders,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status} ao chamar API${body ? `: ${body.slice(0, 180)}` : ""}`);
  }

  return (await response.json()) as T;
}

export function extrairToken(payload: unknown): string | null {
  const visitados = new Set<unknown>();
  const chavesPossiveis = ["token", "access_token", "accessToken", "bearer", "jwt"];

  function visitar(valor: unknown): string | null {
    if (!valor || typeof valor !== "object" || visitados.has(valor)) {
      return null;
    }
    visitados.add(valor);

    const registro = valor as Record<string, unknown>;
    for (const chave of chavesPossiveis) {
      const candidato = registro[chave];
      if (typeof candidato === "string" && candidato.trim()) {
        return candidato.replace(/^Bearer\s+/i, "");
      }
    }

    for (const item of Object.values(registro)) {
      const encontrado = visitar(item);
      if (encontrado) {
        return encontrado;
      }
    }

    return null;
  }

  return visitar(payload);
}
