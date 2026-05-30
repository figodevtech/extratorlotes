export const suporteLeiloesConfig = {
  baseUrl: process.env.SUPORTE_LEILOES_BASE_URL || "https://api.suporteleiloes.com.br",
  authPath: process.env.SUPORTE_LEILOES_AUTH_PATH || "/api/auth",
  authMethod: process.env.SUPORTE_LEILOES_AUTH_METHOD || "POST",
  origin: process.env.SUPORTE_LEILOES_ORIGIN || "https://arrematante.leiloespb.com.br",
  bearerToken: process.env.SUPORTE_LEILOES_BEARER_TOKEN || "",
  username: process.env.SUPORTE_LEILOES_USERNAME || "",
  password: process.env.SUPORTE_LEILOES_PASSWORD || "",
  client: process.env.SUPORTE_LEILOES_CLIENT || "leiloespbcombr",
  pageLimit: Number(process.env.SUPORTE_LEILOES_PAGE_LIMIT || 50),
  concorrenciaLotes: Number(process.env.SUPORTE_LEILOES_CONCORRENCIA_LOTES || 3),
  concorrenciaImagens: Number(process.env.SUPORTE_LEILOES_CONCORRENCIA_IMAGENS || 5),
};

export function montarUrlApi(path: string) {
  return new URL(path, suporteLeiloesConfig.baseUrl).toString();
}
