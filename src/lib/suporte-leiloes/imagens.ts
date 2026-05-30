import { montarUrlApi, suporteLeiloesConfig } from "./config";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function normalizarUrlImagem(valor: string): string {
  const trimmed = valor.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }
  return montarUrlApi(trimmed.startsWith("/") ? trimmed : `/${trimmed}`);
}

export function extrairUrlsDasImagens(loteDetalhado: unknown): string[] {
  if (!isRecord(loteDetalhado) || !isRecord(loteDetalhado.bem) || !Array.isArray(loteDetalhado.bem.arquivos)) {
    return [];
  }

  return loteDetalhado.bem.arquivos
    .filter((arquivo) => {
      if (!isRecord(arquivo) || !isRecord(arquivo.tipo)) {
        return false;
      }

      return arquivo.site === true && arquivo.tipo.codigo === "foto-site" && typeof arquivo.url === "string";
    })
    .map((arquivo) => normalizarUrlImagem((arquivo as { url: string }).url));
}

export function sanitizarNomePasta(valor: string | number): string {
  const nome = String(valor).replace(/[\\/:*?"<>|]/g, "-").trim();
  return nome || "lote-sem-numero";
}

export function extensaoImagem(url: string, contentType?: string | null): string {
  const pathname = new URL(url).pathname;
  const match = pathname.match(/\.(jpe?g|png|webp|gif|bmp)$/i);
  if (match) {
    return `.${match[1].toLowerCase().replace("jpeg", "jpg")}`;
  }

  if (contentType?.includes("png")) return ".png";
  if (contentType?.includes("webp")) return ".webp";
  if (contentType?.includes("gif")) return ".gif";
  return ".jpg";
}

export async function baixarImagem(url: string, token?: string): Promise<{ buffer: ArrayBuffer; contentType: string | null }> {
  const response = await fetch(url, {
    headers: {
      Origin: suporteLeiloesConfig.origin,
      Referer: `${suporteLeiloesConfig.origin}/`,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return {
    buffer: await response.arrayBuffer(),
    contentType: response.headers.get("content-type"),
  };
}
