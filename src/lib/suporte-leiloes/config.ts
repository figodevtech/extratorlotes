import type { ExtratorId } from "@/lib/extratores";

export type SuporteLeiloesConfig = {
  baseUrl: string;
  authPath: string;
  authMethod: string;
  origin: string;
  bearerToken: string;
  username: string;
  password: string;
  client: string;
  pageLimit: number;
  concorrenciaLotes: number;
  concorrenciaImagens: number;
};

function configLeiloesPb(): SuporteLeiloesConfig {
  return {
    baseUrl:
      process.env.LEILOES_PB_BASE_URL ||
      process.env.SUPORTE_LEILOES_BASE_URL ||
      "https://api.suporteleiloes.com.br",
    authPath: process.env.LEILOES_PB_AUTH_PATH || process.env.SUPORTE_LEILOES_AUTH_PATH || "/api/auth",
    authMethod: process.env.LEILOES_PB_AUTH_METHOD || process.env.SUPORTE_LEILOES_AUTH_METHOD || "POST",
    origin:
      process.env.LEILOES_PB_ORIGIN ||
      process.env.SUPORTE_LEILOES_ORIGIN ||
      "https://arrematante.leiloespb.com.br",
    bearerToken: process.env.LEILOES_PB_BEARER_TOKEN || process.env.SUPORTE_LEILOES_BEARER_TOKEN || "",
    username: process.env.LEILOES_PB_USERNAME || process.env.SUPORTE_LEILOES_USERNAME || "",
    password: process.env.LEILOES_PB_PASSWORD || process.env.SUPORTE_LEILOES_PASSWORD || "",
    client: process.env.LEILOES_PB_CLIENT || process.env.SUPORTE_LEILOES_CLIENT || "leiloespbcombr",
    pageLimit: Number(process.env.EXTRATOR_PAGE_LIMIT || process.env.SUPORTE_LEILOES_PAGE_LIMIT || 50),
    concorrenciaLotes: Number(
      process.env.EXTRATOR_CONCORRENCIA_LOTES || process.env.SUPORTE_LEILOES_CONCORRENCIA_LOTES || 3,
    ),
    concorrenciaImagens: Number(
      process.env.EXTRATOR_CONCORRENCIA_IMAGENS || process.env.SUPORTE_LEILOES_CONCORRENCIA_IMAGENS || 5,
    ),
  };
}

function configGoldenLance(): SuporteLeiloesConfig {
  return {
    baseUrl: process.env.GOLDEN_LANCE_BASE_URL || "https://api.suporteleiloes.com.br",
    authPath: process.env.GOLDEN_LANCE_AUTH_PATH || "/api/auth",
    authMethod: process.env.GOLDEN_LANCE_AUTH_METHOD || "POST",
    origin: process.env.GOLDEN_LANCE_ORIGIN || "",
    bearerToken: process.env.GOLDEN_LANCE_BEARER_TOKEN || "",
    username: process.env.GOLDEN_LANCE_USERNAME || "",
    password: process.env.GOLDEN_LANCE_PASSWORD || "",
    client: process.env.GOLDEN_LANCE_CLIENT || "",
    pageLimit: Number(process.env.EXTRATOR_PAGE_LIMIT || 50),
    concorrenciaLotes: Number(process.env.EXTRATOR_CONCORRENCIA_LOTES || 3),
    concorrenciaImagens: Number(process.env.EXTRATOR_CONCORRENCIA_IMAGENS || 5),
  };
}

export function obterConfigSuporteLeiloes(extrator: ExtratorId): SuporteLeiloesConfig {
  if (extrator === "golden-lance") {
    return configGoldenLance();
  }

  return configLeiloesPb();
}

export const suporteLeiloesConfig = configLeiloesPb();

export function montarUrlApi(path: string, config: SuporteLeiloesConfig = suporteLeiloesConfig) {
  return new URL(path, config.baseUrl).toString();
}
