import axios from "axios";
import * as cheerio from "cheerio";
import type { LoteFotos } from "@/lib/suporte-leiloes/jobs";
import { mapComConcorrencia } from "@/lib/suporte-leiloes/pool";

const BASE_URL = "https://www.parquedosleiloes.com.br";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";
const MAX_PAGINAS_DETALHES = 100;
const CONCORRENCIA_LOTES = Number(process.env.EXTRATOR_SCRAPER_CONCORRENCIA_LOTES || 8);
const DELAY_PAGINAS_MS = Number(process.env.EXTRATOR_SCRAPER_DELAY_PAGINAS_MS || 100);

type HtmlResponse = {
  data: string;
};

function normalizarUrl(valor: string, base = BASE_URL) {
  return new URL(valor, base).toString();
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function buscarHtml(url: string): Promise<string> {
  const response = await axios.get<string, HtmlResponse>(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    timeout: 30000,
  });

  return response.data;
}

export function extrairIdLeilaoParque(urlLeilao: string): string | null {
  const match = urlLeilao.match(/\/leilao\/(\d+)/);
  return match ? match[1] : null;
}

export function validarUrlParque(urlLeilao: string): string {
  let url: URL;
  try {
    url = new URL(urlLeilao);
  } catch {
    throw new Error("O link informado e invalido.");
  }

  const hostname = url.hostname.replace(/^www\./, "");
  if (hostname !== "parquedosleiloes.com.br") {
    throw new Error("Use apenas links do dominio parquedosleiloes.com.br.");
  }

  const leilaoId = extrairIdLeilaoParque(urlLeilao);
  if (!leilaoId) {
    throw new Error("Nao foi possivel identificar o ID do leilao no link informado.");
  }

  return leilaoId;
}

export function extrairLinksLotes(html: string, leilaoId: string): string[] {
  const $ = cheerio.load(html);
  const links = new Set<string>();
  const pattern = `/leilao/${leilaoId}/lote/`;

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (href?.includes(pattern)) {
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
    $("body").text().slice(0, 3000),
  ];

  for (const texto of candidatos) {
    const match = texto.match(/lote\s*(?:n[ºo.]*)?\s*[:#-]?\s*(\d+)/i);
    if (match?.[1]) {
      return match[1];
    }
  }

  return fallback;
}

export function extrairImagensLote(html: string): string[] {
  const $ = cheerio.load(html);
  const imagens = new Set<string>();
  const atributos = ["src", "data-src", "data-lazy", "data-original"];
  const escopo = $(".photos").length > 0 ? $(".photos") : $("body");

  escopo.find("img").each((_, element) => {
    for (const atributo of atributos) {
      const valor = $(element).attr(atributo);
      if (!valor) {
        continue;
      }

      const url = normalizarUrl(valor);
      if (/\/storage\/vehicles\//i.test(url) && /\.(webp|jpe?g|png)(\?.*)?$/i.test(url)) {
        imagens.add(url);
      }
    }
  });

  return [...imagens];
}

export async function listarFotosParqueDosLeiloes(
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
  const linksUnicos = new Set<string>();
  const fotos: LoteFotos[] = [];
  let totalImagens = 0;

  for (let page = 1; page <= MAX_PAGINAS_DETALHES; page += 1) {
    const detalhesUrl = `${BASE_URL}/leilao/${leilaoId}/detalhes${page > 1 ? `?page=${page}` : ""}`;
    const detalhesHtml = await buscarHtml(detalhesUrl);
    const linksPagina = extrairLinksLotes(detalhesHtml, leilaoId);
    const novosLinks = linksPagina.filter((link) => !linksUnicos.has(link));

    if (novosLinks.length === 0) {
      break;
    }

    for (const link of novosLinks) {
      linksUnicos.add(link);
      links.push(link);
    }

    if (DELAY_PAGINAS_MS > 0) {
      await delay(DELAY_PAGINAS_MS);
    }
  }

  let lotesProcessados = 0;
  const resultados = await mapComConcorrencia(links, CONCORRENCIA_LOTES, async (loteUrl, index) => {
    const loteId = loteUrl.match(/\/lote\/(\d+)/)?.[1] || String(index + 1);

    try {
      const loteHtml = await buscarHtml(loteUrl);
      const $ = cheerio.load(loteHtml);
      const numero = extrairNumeroLote($, index + 1);
      const imagens = extrairImagensLote(loteHtml).map((url, imageIndex) => ({
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
