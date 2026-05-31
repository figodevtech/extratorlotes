import { fetchJson } from "./client";
import { montarUrlApi, suporteLeiloesConfig, type SuporteLeiloesConfig } from "./config";

export type LoteResumo = {
  id: number | string;
  numero: number | string;
  titulo?: string;
};

type PaginaLotes = {
  itens: unknown[];
  total?: number;
  hasNext?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function escolherArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!isRecord(payload)) {
    return [];
  }

  const chaves = ["data", "rows", "items", "lotes", "result", "results", "content"];
  for (const chave of chaves) {
    const valor = payload[chave];
    if (Array.isArray(valor)) {
      return valor;
    }
    if (isRecord(valor)) {
      const nested = escolherArray(valor);
      if (nested.length > 0) {
        return nested;
      }
    }
  }

  return [];
}

function extrairTotal(payload: unknown): number | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  for (const chave of ["total", "count", "totalItems", "totalElements", "recordsTotal"]) {
    const valor = payload[chave];
    if (typeof valor === "number") {
      return valor;
    }
  }

  for (const valor of Object.values(payload)) {
    const total = extrairTotal(valor);
    if (total !== undefined) {
      return total;
    }
  }

  return undefined;
}

function normalizarLote(item: unknown): LoteResumo | null {
  if (!isRecord(item)) {
    return null;
  }

  const id = item.id ?? item.loteId ?? item.idLote ?? item.codigo;
  const numero = item.numero ?? item.numLote ?? item.numeroLote ?? item.ordem ?? id;

  if ((typeof id !== "string" && typeof id !== "number") || numero === undefined) {
    return null;
  }

  const titulo = item.titulo ?? item.nome ?? item.descricao;
  return {
    id,
    numero: typeof numero === "string" || typeof numero === "number" ? numero : String(numero),
    titulo: typeof titulo === "string" ? titulo : undefined,
  };
}

function interpretarPagina(payload: unknown, page: number, limit: number): PaginaLotes {
  const itens = escolherArray(payload);
  const total = extrairTotal(payload);
  const hasNext = total !== undefined ? page * limit < total : itens.length === limit;

  return { itens, total, hasNext };
}

export async function buscarTodosOsLotes(
  leilaoId: string,
  token: string,
  config: SuporteLeiloesConfig = suporteLeiloesConfig,
): Promise<LoteResumo[]> {
  const limit = config.pageLimit;
  const lotes: LoteResumo[] = [];
  let page = 1;
  let hasNext = true;

  while (hasNext) {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      sortBy: "numero",
      descending: "false",
      search: "",
    });
    const url = montarUrlApi(`/api/arrematantes/service/leiloes/${leilaoId}/lotes?${params}`, config);
    const payload = await fetchJson<unknown>(url, token, undefined, config);
    const pagina = interpretarPagina(payload, page, limit);

    lotes.push(...pagina.itens.map(normalizarLote).filter((lote): lote is LoteResumo => Boolean(lote)));
    hasNext = Boolean(pagina.hasNext && pagina.itens.length > 0);
    page += 1;
  }

  return lotes;
}

export async function buscarLoteDetalhado(
  loteId: string | number,
  token: string,
  config: SuporteLeiloesConfig = suporteLeiloesConfig,
): Promise<unknown> {
  return fetchJson<unknown>(montarUrlApi(`/api/arrematantes/service/lotes/${loteId}`, config), token, undefined, config);
}
