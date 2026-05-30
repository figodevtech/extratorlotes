import JSZip from "jszip";
import { suporteLeiloesConfig } from "./config";
import { baixarImagem, extensaoImagem, extrairUrlsDasImagens, sanitizarNomePasta } from "./imagens";
import type { LoteFotos } from "./jobs";
import { buscarLoteDetalhado, type LoteResumo } from "./lotes";
import { mapComConcorrencia } from "./pool";

export type RelatorioExtracao = {
  leilaoId: string;
  totalLotes: number;
  lotesProcessados: number;
  totalImagens: number;
  lotesSemImagem: Array<string | number>;
  erros: Array<{ lote?: string | number; tipo: string; url?: string; mensagem: string }>;
};

export type ProgressoExtracao = {
  loteAtual?: string | number;
  lotesProcessados: number;
  totalLotes: number;
  totalImagens: number;
  percentual: number;
};

function indiceParaLetras(index: number): string {
  let valor = index;
  let letras = "";

  do {
    letras = String.fromCharCode(97 + (valor % 26)) + letras;
    valor = Math.floor(valor / 26) - 1;
  } while (valor >= 0);

  return letras;
}

export async function gerarZipFotosLeilao(
  leilaoId: string,
  nomePastaLeilao: string,
  lotes: LoteResumo[],
  token: string,
  onProgress?: (progresso: ProgressoExtracao) => void,
): Promise<{ buffer: Buffer; relatorio: RelatorioExtracao }> {
  const zip = new JSZip();
  const pastaLeilao = zip.folder(sanitizarNomePasta(nomePastaLeilao));

  if (!pastaLeilao) {
    throw new Error("Nao foi possivel criar a pasta do leilao no ZIP.");
  }

  const relatorio: RelatorioExtracao = {
    leilaoId,
    totalLotes: lotes.length,
    lotesProcessados: 0,
    totalImagens: 0,
    lotesSemImagem: [],
    erros: [],
  };

  await mapComConcorrencia(lotes, suporteLeiloesConfig.concorrenciaLotes, async (lote) => {
    onProgress?.({
      loteAtual: lote.numero,
      lotesProcessados: relatorio.lotesProcessados,
      totalLotes: relatorio.totalLotes,
      totalImagens: relatorio.totalImagens,
      percentual: Math.round((relatorio.lotesProcessados / Math.max(1, relatorio.totalLotes)) * 100),
    });

    try {
      const detalhe = await buscarLoteDetalhado(lote.id, token);
      const urls = extrairUrlsDasImagens(detalhe);
      const loteNomeArquivo = sanitizarNomePasta(lote.numero);

      if (urls.length === 0) {
        relatorio.lotesSemImagem.push(lote.numero);
      }

      await mapComConcorrencia(urls, suporteLeiloesConfig.concorrenciaImagens, async (url, index) => {
        try {
          const imagem = await baixarImagem(url, token);
          const extensao = extensaoImagem(url, imagem.contentType);
          pastaLeilao.file(`${loteNomeArquivo}${indiceParaLetras(index)}${extensao}`, Buffer.from(imagem.buffer));
          relatorio.totalImagens += 1;
        } catch (error) {
          relatorio.erros.push({
            lote: lote.numero,
            tipo: "download_imagem",
            url,
            mensagem: error instanceof Error ? error.message : "Erro ao baixar imagem",
          });
        }
      });
    } catch (error) {
      relatorio.erros.push({
        lote: lote.numero,
        tipo: "processar_lote",
        mensagem: error instanceof Error ? error.message : "Erro ao processar lote",
      });
    } finally {
      relatorio.lotesProcessados += 1;
      onProgress?.({
        loteAtual: lote.numero,
        lotesProcessados: relatorio.lotesProcessados,
        totalLotes: relatorio.totalLotes,
        totalImagens: relatorio.totalImagens,
        percentual: Math.round((relatorio.lotesProcessados / Math.max(1, relatorio.totalLotes)) * 100),
      });
    }
  });

  zip.file("relatorio.json", JSON.stringify(relatorio, null, 2));
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { buffer, relatorio };
}

export async function gerarZipFotosSelecionadas(
  leilaoId: string,
  nomePastaLeilao: string,
  lotesFotos: LoteFotos[],
  imagensSelecionadas: string[],
  onProgress?: (progresso: ProgressoExtracao) => void,
): Promise<{ buffer: Buffer; relatorio: RelatorioExtracao }> {
  const zip = new JSZip();
  const pastaLeilao = zip.folder(sanitizarNomePasta(nomePastaLeilao));
  const selecionadas = new Set(imagensSelecionadas);

  if (!pastaLeilao) {
    throw new Error("Nao foi possivel criar a pasta do leilao no ZIP.");
  }

  const lotesComFotos = lotesFotos
    .map((lote) => ({
      ...lote,
      imagens: lote.imagens.filter((imagem) => selecionadas.has(imagem.id)),
    }))
    .filter((lote) => lote.imagens.length > 0);

  const relatorio: RelatorioExtracao = {
    leilaoId,
    totalLotes: lotesFotos.length,
    lotesProcessados: 0,
    totalImagens: 0,
    lotesSemImagem: lotesFotos.filter((lote) => lote.imagens.length === 0).map((lote) => lote.numero),
    erros: [],
  };

  await mapComConcorrencia(lotesComFotos, suporteLeiloesConfig.concorrenciaLotes, async (lote) => {
    const loteNomeArquivo = sanitizarNomePasta(lote.numero);

    onProgress?.({
      loteAtual: lote.numero,
      lotesProcessados: relatorio.lotesProcessados,
      totalLotes: lotesComFotos.length,
      totalImagens: relatorio.totalImagens,
      percentual: Math.round((relatorio.lotesProcessados / Math.max(1, lotesComFotos.length)) * 100),
    });

    await mapComConcorrencia(lote.imagens, suporteLeiloesConfig.concorrenciaImagens, async (imagem, index) => {
      try {
        const arquivo = await baixarImagem(imagem.url);
        const extensao = extensaoImagem(imagem.url, arquivo.contentType);
        pastaLeilao.file(`${loteNomeArquivo}${indiceParaLetras(index)}${extensao}`, Buffer.from(arquivo.buffer));
        relatorio.totalImagens += 1;
      } catch (error) {
        relatorio.erros.push({
          lote: lote.numero,
          tipo: "download_imagem",
          url: imagem.url,
          mensagem: error instanceof Error ? error.message : "Erro ao baixar imagem",
        });
      }
    });

    relatorio.lotesProcessados += 1;
    onProgress?.({
      loteAtual: lote.numero,
      lotesProcessados: relatorio.lotesProcessados,
      totalLotes: lotesComFotos.length,
      totalImagens: relatorio.totalImagens,
      percentual: Math.round((relatorio.lotesProcessados / Math.max(1, lotesComFotos.length)) * 100),
    });
  });

  zip.file("relatorio.json", JSON.stringify(relatorio, null, 2));
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { buffer, relatorio };
}
