import axios from "axios";
import * as cheerio from "cheerio";
import type { LoteFotos } from "@/lib/suporte-leiloes/jobs";
import { mapComConcorrencia } from "@/lib/suporte-leiloes/pool";

const BASE_URL = "https://www.rogeriomenezes.com.br";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";
const MAX_PAGINAS = 30;
const CONCORRENCIA_LOTES = Number(process.env.EXTRATOR_SCRAPER_CONCORRENCIA_LOTES || 8);
const DELAY_PAGINAS_MS = Number(process.env.EXTRATOR_SCRAPER_DELAY_PAGINAS_MS || 100);

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizarUrl(valor: string) {
  const url = new URL(valor.replace(/\\\//g, "/"), BASE_URL);
  url.hash = "";
  return url.toString();
}

async function buscarHtml(url: string): Promise<string> {
  const response = await axios.get<string>(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    timeout: 30000,
  });

  return response.data;
}

export function validarUrlRogerioMenezes(urlLeilao: string): string {
  let url: URL;
  try {
    url = new URL(urlLeilao);
  } catch {
    throw new Error("O link informado e invalido.");
  }

  const hostname = url.hostname.replace(/^www\./, "");
  if (hostname !== "rogeriomenezes.com.br") {
    throw new Error("Use apenas links do dominio rogeriomenezes.com.br.");
  }

  const leilaoId = url.pathname.match(/\/leilao\/(\d+)/)?.[1];
  if (!leilaoId) {
    throw new Error("Nao foi possivel identificar o ID do leilao no link informado.");
  }

  return leilaoId;
}

export function extrairLinksLotesRogerio(html: string): string[] {
  const $ = cheerio.load(html);
  const links = new Set<string>();

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (href && /\/lote\/\d+\//.test(href)) {
      links.add(normalizarUrl(href));
    }
  });

  return [...links];
}

function extrairNumeroLote($: cheerio.CheerioAPI, fallback: number): string | number {
  const candidatos = [
    $("h1").first().text(),
    $("h2").first().text(),
    $("[class*=lote], [id*=lote]").first().text(),
    $("body").text().slice(0, 4000),
  ];

  for (const texto of candidatos) {
    const match = texto.match(/lote\s*(?:n[ºo.]*)?\s*[:#-]?\s*(\d+)/i);
    if (match?.[1]) {
      return match[1];
    }
  }

  return fallback;
}

function extrairSrcset(valor: string): string[] {
  return valor
    .split(",")
    .map((item) => item.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function pareceImagemDeLote(url: string): boolean {
  const lower = url.toLowerCase();
  const pareceImagem =
    /\.(webp|jpe?g|png|gif)(\?.*)?$/.test(lower) &&
    /static\.suporteleiloes\.com\.br\/rogeriomenezescombr\/bens\/\d+\/arquivos\//.test(lower);

  return pareceImagem;
}

function extrairBemId(url: string): string | null {
  return url.match(/\/bens\/(\d+)\/arquivos\//)?.[1] || null;
}

function filtrarBemDominante(urls: string[]): string[] {
  const contagem = new Map<string, number>();

  for (const url of urls) {
    const bemId = extrairBemId(url);
    if (bemId) {
      contagem.set(bemId, (contagem.get(bemId) || 0) + 1);
    }
  }

  const bemDominante = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!bemDominante) {
    return urls;
  }

  return urls.filter((url) => extrairBemId(url) === bemDominante);
}

export function extrairImagensRogerio(html: string): string[] {
  const $ = cheerio.load(html);
  const imagensGaleria = new Set<string>();
  const imagensFallback = new Set<string>();
  const atributos = ["src", "data-src", "data-lazy", "data-original"];

  function adicionar(destino: Set<string>, valor?: string | null) {
    if (!valor) return;
    const url = normalizarUrl(valor);
    if (pareceImagemDeLote(url)) {
      destino.add(url);
    }
  }

  $("a[href]").each((_, element) => adicionar(imagensGaleria, $(element).attr("href")));

  $("img").each((_, element) => {
    for (const atributo of atributos) {
      adicionar(imagensFallback, $(element).attr(atributo));
    }

    const srcset = $(element).attr("srcset");
    if (srcset) {
      for (const item of extrairSrcset(srcset)) {
        adicionar(imagensFallback, item);
      }
    }
  });

  $("script").each((_, element) => {
    const conteudo = $(element).html() || "";
    const matches = conteudo.matchAll(
      /https?:\\?\/\\?\/[^"'`\s\\]+|\/[A-Za-z0-9_./%?=&-]+\.(?:webp|jpe?g|png|gif)(?:\?[^"'`\s]*)?/gi,
    );

    for (const match of matches) {
      adicionar(imagensFallback, match[0]);
    }
  });

  const galeriaFiltrada = filtrarBemDominante([...imagensGaleria]);
  return galeriaFiltrada.length > 0 ? galeriaFiltrada : filtrarBemDominante([...imagensFallback]);
}

export async function listarFotosRogerioMenezes(
  leilaoId: string,
  onProgress?: (progresso: {
    loteAtual?: string | number;
    totalLotes: number;
    lotesProcessados: number;
    totalImagens: number;
    percentual: number;
  }) => void,
): Promise<LoteFotos[]> {
  const links: string[] = [];
  const unicos = new Set<string>();

  for (let page = 1; page <= MAX_PAGINAS; page += 1) {
    const url = `${BASE_URL}/leilao/${leilaoId}?page=${page}`;
    const html = await buscarHtml(url);
    const linksPagina = extrairLinksLotesRogerio(html);
    const novos = linksPagina.filter((link) => !unicos.has(link));

    if (novos.length === 0) {
      break;
    }

    for (const link of novos) {
      unicos.add(link);
      links.push(link);
    }

    if (DELAY_PAGINAS_MS > 0) {
      await delay(DELAY_PAGINAS_MS);
    }
  }

  const fotos: LoteFotos[] = [];
  let totalImagens = 0;
  let lotesProcessados = 0;

  const resultados = await mapComConcorrencia(links, CONCORRENCIA_LOTES, async (loteUrl, index) => {
    const loteId = loteUrl.match(/\/lote\/(\d+)\//)?.[1] || String(index + 1);

    try {
      const html = await buscarHtml(loteUrl);
      const $ = cheerio.load(html);
      const numero = extrairNumeroLote($, index + 1);
      const imagens = extrairImagensRogerio(html).map((url, imageIndex) => ({
        id: `${loteId}:${imageIndex}`,
        url,
      }));

      totalImagens += imagens.length;
      lotesProcessados += 1;
      onProgress?.({
        loteAtual: numero,
        totalLotes: links.length,
        lotesProcessados,
        totalImagens,
        percentual: Math.round((lotesProcessados / Math.max(1, links.length)) * 100),
      });
      return { loteId, numero, imagens };
    } catch {
      lotesProcessados += 1;
      onProgress?.({
        loteAtual: index + 1,
        totalLotes: links.length,
        lotesProcessados,
        totalImagens,
        percentual: Math.round((lotesProcessados / Math.max(1, links.length)) * 100),
      });
      return { loteId, numero: index + 1, imagens: [] };
    }
  });

  fotos.push(...resultados);
  return fotos;
}
