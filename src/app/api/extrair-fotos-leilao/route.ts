import { NextRequest, NextResponse } from "next/server";
import { createRequire } from "node:module";
import { Readable } from "node:stream";
import { z } from "zod";
import { obterExtrator, type ExtratorId } from "@/lib/extratores";
import { listarFotosParqueDosLeiloes, validarUrlParque } from "@/lib/parque-dos-leiloes/extrator";
import { listarFotosRogerioMenezes, validarUrlRogerioMenezes } from "@/lib/rogerio-menezes/extrator";
import { autenticarSuporteLeiloes } from "@/lib/suporte-leiloes/auth";
import { obterConfigSuporteLeiloes, type SuporteLeiloesConfig } from "@/lib/suporte-leiloes/config";
import { baixarImagem, extensaoImagem, extrairUrlsDasImagens, sanitizarNomePasta } from "@/lib/suporte-leiloes/imagens";
import { atualizarJob, criarJob, obterJob, serializarJob } from "@/lib/suporte-leiloes/jobs";
import { buscarLoteDetalhado, buscarTodosOsLotes } from "@/lib/suporte-leiloes/lotes";
import { mapComConcorrencia } from "@/lib/suporte-leiloes/pool";
import { gerarZipFotosSelecionadas } from "@/lib/suporte-leiloes/zip";

const require = createRequire(import.meta.url);
const archiver = require("archiver") as typeof import("archiver");

export const runtime = "nodejs";
export const maxDuration = 300;
export const preferredRegion = "gru1";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Expose-Headers": "Content-Disposition",
  "Access-Control-Max-Age": "86400",
};

function jsonCors(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, {
    ...init,
    headers: {
      ...corsHeaders,
      ...init?.headers,
    },
  });
}

const iniciarSchema = z.object({
  extrator: z.enum(["leiloes-pb", "golden-lance", "parque-dos-leiloes", "rogerio-menezes"]),
  urlLeilao: z.string().url("Informe uma URL valida."),
});

const gerarZipSchema = z.object({
  action: z.literal("gerar_zip"),
  jobId: z.string().min(1),
  imagensSelecionadas: z.array(z.string()).min(1, "Selecione ao menos uma imagem."),
});

const baixarZipDiretoSchema = z.object({
  action: z.literal("baixar_zip_direto"),
  jobId: z.string().min(1),
  imagensSelecionadas: z.array(z.string()).min(1, "Selecione ao menos uma imagem."),
});

export function extrairIdLeilao(url: string): string | null {
  const match = url.match(/\/leilao\/(\d+)/);
  return match ? match[1] : null;
}

function indiceParaLetras(index: number): string {
  let valor = index;
  let letras = "";

  do {
    letras = String.fromCharCode(97 + (valor % 26)) + letras;
    valor = Math.floor(valor / 26) - 1;
  } while (valor >= 0);

  return letras;
}

function extrairNomePastaLeilao(urlLeilao: string, leilaoId: string): string {
  const url = new URL(urlLeilao);
  const match = url.pathname.match(/\/leilao\/\d+\/([^/?#]+)/);
  const slug = match?.[1] ? decodeURIComponent(match[1]) : "";

  return sanitizarNomePasta(slug || `leilao-${leilaoId}`);
}

function validarExtrator(extratorId: ExtratorId) {
  const extrator = obterExtrator(extratorId);
  if (!extrator) {
    throw new Error("Selecione um extrator valido.");
  }

  if (!extrator.implementado) {
    throw new Error(`O metodo de extracao para ${extrator.nome} ainda nao foi implementado.`);
  }

  return extrator;
}

function validarUrlSuporteLeiloes(urlLeilao: string, extratorId: ExtratorId) {
  let url: URL;
  try {
    url = new URL(urlLeilao);
  } catch {
    throw new Error("O link informado e invalido.");
  }

  const hostname = url.hostname.replace(/^www\./, "");
  if (extratorId === "leiloes-pb" && hostname !== "leiloespb.com.br") {
    throw new Error("Use apenas links do dominio leiloespb.com.br.");
  }

  const leilaoId = extrairIdLeilao(url.pathname);
  if (!leilaoId) {
    throw new Error("Nao foi possivel identificar o ID do leilao no link informado.");
  }

  return leilaoId;
}

function erroAmigavel(error: unknown) {
  const mensagem = error instanceof Error ? error.message : "Erro inesperado ao processar o leilao.";

  if (/SUPORTE_LEILOES_USERNAME|SUPORTE_LEILOES_PASSWORD|usuario e senha|Login|token|401|403/i.test(mensagem)) {
    return "Falha na autenticacao. Verifique usuario, senha, cliente, origin e endpoint de login do cliente selecionado no .env.local.";
  }

  return mensagem;
}

function obterConfigDownload(jobExtratorId?: string): SuporteLeiloesConfig {
  if (jobExtratorId === "parque-dos-leiloes" || jobExtratorId === "rogerio-menezes") {
    return {
      baseUrl: "",
      authPath: "",
      authMethod: "GET",
      origin: "",
      bearerToken: "",
      username: "",
      password: "",
      client: "",
      pageLimit: 50,
      concorrenciaLotes: Number(process.env.EXTRATOR_CONCORRENCIA_LOTES || 3),
      concorrenciaImagens: Number(process.env.EXTRATOR_CONCORRENCIA_IMAGENS || 5),
    };
  }

  return obterConfigSuporteLeiloes((jobExtratorId || "leiloes-pb") as ExtratorId);
}

async function executarListagemSuporteLeiloes(jobId: string, urlLeilao: string, extratorId: ExtratorId) {
  try {
    const config = obterConfigSuporteLeiloes(extratorId);
    const leilaoId = validarUrlSuporteLeiloes(urlLeilao, extratorId);
    const nomePastaLeilao = extrairNomePastaLeilao(urlLeilao, leilaoId);
    atualizarJob(jobId, {
      extratorId,
      status: "autenticando",
      leilaoId,
      percentual: 2,
      mensagem: "Autenticando...",
    });

    const token = await autenticarSuporteLeiloes(config);
    atualizarJob(jobId, {
      status: "buscando lotes",
      percentual: 5,
      mensagem: "Buscando lotes do leilao.",
    });

    const lotes = await buscarTodosOsLotes(leilaoId, token, config);
    if (lotes.length === 0) {
      throw new Error("O leilao informado nao possui lotes retornados pela API.");
    }

    atualizarJob(jobId, {
      status: "buscando lotes",
      totalLotes: lotes.length,
      lotesProcessados: 0,
      percentual: 0,
      mensagem: `Buscando fotos de ${lotes.length} lotes.`,
    });

    let lotesProcessados = 0;
    let totalImagens = 0;
    const fotos = await mapComConcorrencia(lotes, 3, async (lote) => {
      try {
        atualizarJob(jobId, {
          loteAtual: lote.numero,
          mensagem: `Lendo fotos do lote ${lote.numero}.`,
        });

        const detalhe = await buscarLoteDetalhado(lote.id, token, config);
        const urls = extrairUrlsDasImagens(detalhe);
        totalImagens += urls.length;

        return {
          loteId: lote.id,
          numero: lote.numero,
          imagens: urls.map((url, index) => ({
            id: `${lote.id}:${index}`,
            url,
          })),
        };
      } finally {
        lotesProcessados += 1;
        atualizarJob(jobId, {
          loteAtual: lote.numero,
          lotesProcessados,
          totalImagens,
          percentual: Math.round((lotesProcessados / Math.max(1, lotes.length)) * 100),
        });
      }
    });

    fotos.sort((a, b) => Number(a.numero) - Number(b.numero));
    atualizarJob(jobId, {
      status: "concluido",
      percentual: 100,
      totalImagens,
      lotesProcessados,
      nomePastaLeilao,
      fotos,
      zipBuffer: undefined,
      filename: undefined,
      mensagem: "Fotos listadas. Selecione as imagens para download.",
    });
  } catch (error) {
    const mensagem = erroAmigavel(error);
    atualizarJob(jobId, {
      status: "erro",
      erro: mensagem,
      mensagem,
    });
  }
}

async function executarListagemParqueDosLeiloes(jobId: string, urlLeilao: string) {
  try {
    const leilaoId = validarUrlParque(urlLeilao);
    const nomePastaLeilao = `leilao-${leilaoId}`;

    atualizarJob(jobId, {
      extratorId: "parque-dos-leiloes",
      status: "buscando lotes",
      leilaoId,
      percentual: 0,
      mensagem: "Buscando lotes do leilao.",
    });

    const fotos = await listarFotosParqueDosLeiloes(leilaoId, (progresso) => {
      atualizarJob(jobId, {
        status: "buscando lotes",
        loteAtual: progresso.loteAtual,
        totalLotes: progresso.totalLotes,
        lotesProcessados: progresso.lotesProcessados,
        totalImagens: progresso.totalImagens,
        percentual: progresso.percentual,
        mensagem: progresso.loteAtual ? `Lendo fotos do lote ${progresso.loteAtual}.` : "Lendo fotos dos lotes.",
      });
    });

    if (fotos.length === 0) {
      throw new Error("Nenhum lote foi encontrado na pagina de detalhes do leilao.");
    }

    const totalImagens = fotos.reduce((total, lote) => total + lote.imagens.length, 0);

    atualizarJob(jobId, {
      status: "concluido",
      percentual: 100,
      totalLotes: fotos.length,
      lotesProcessados: fotos.length,
      totalImagens,
      nomePastaLeilao,
      fotos,
      zipBuffer: undefined,
      filename: undefined,
      mensagem: "Fotos listadas. Selecione as imagens para download.",
    });
  } catch (error) {
    const mensagem = erroAmigavel(error);
    atualizarJob(jobId, {
      status: "erro",
      erro: mensagem,
      mensagem,
    });
  }
}

async function executarListagemRogerioMenezes(jobId: string, urlLeilao: string) {
  try {
    const leilaoId = validarUrlRogerioMenezes(urlLeilao);
    const nomePastaLeilao = `leilao-${leilaoId}-rogerio-menezes`;

    atualizarJob(jobId, {
      extratorId: "rogerio-menezes",
      status: "buscando lotes",
      leilaoId,
      percentual: 0,
      mensagem: "Buscando lotes do leilao.",
    });

    const fotos = await listarFotosRogerioMenezes(leilaoId, (progresso) => {
      atualizarJob(jobId, {
        status: "buscando lotes",
        loteAtual: progresso.loteAtual,
        totalLotes: progresso.totalLotes,
        lotesProcessados: progresso.lotesProcessados,
        totalImagens: progresso.totalImagens,
        percentual: progresso.percentual,
        mensagem: progresso.loteAtual ? `Lendo fotos do lote ${progresso.loteAtual}.` : "Lendo fotos dos lotes.",
      });
    });

    if (fotos.length === 0) {
      throw new Error("Nenhum lote foi encontrado na pagina do leilao.");
    }

    const totalImagens = fotos.reduce((total, lote) => total + lote.imagens.length, 0);

    atualizarJob(jobId, {
      status: "concluido",
      percentual: 100,
      totalLotes: fotos.length,
      lotesProcessados: fotos.length,
      totalImagens,
      nomePastaLeilao,
      fotos,
      zipBuffer: undefined,
      filename: undefined,
      mensagem: "Fotos listadas. Selecione as imagens para download.",
    });
  } catch (error) {
    const mensagem = erroAmigavel(error);
    atualizarJob(jobId, {
      status: "erro",
      erro: mensagem,
      mensagem,
    });
  }
}

async function executarGeracaoZip(jobId: string, imagensSelecionadas: string[]) {
  const job = obterJob(jobId);
  if (!job?.leilaoId || !job.nomePastaLeilao || !job.fotos) {
    atualizarJob(jobId, {
      status: "erro",
      erro: "A lista de fotos desta extracao nao esta disponivel.",
      mensagem: "A lista de fotos desta extracao nao esta disponivel.",
    });
    return;
  }

  try {
    const config = obterConfigDownload(job.extratorId);
    atualizarJob(jobId, {
      status: "gerando ZIP",
      percentual: 0,
      zipBuffer: undefined,
      filename: undefined,
      mensagem: "Gerando ZIP com as imagens selecionadas.",
    });

    const resultado = await gerarZipFotosSelecionadas(
      job.leilaoId,
      job.nomePastaLeilao,
      job.fotos,
      imagensSelecionadas,
      (progresso) => {
        atualizarJob(jobId, {
          status: "gerando ZIP",
          loteAtual: progresso.loteAtual,
          totalLotes: progresso.totalLotes,
          lotesProcessados: progresso.lotesProcessados,
          totalImagens: progresso.totalImagens,
          percentual: progresso.percentual,
          mensagem: progresso.loteAtual
            ? `Baixando fotos do lote ${progresso.loteAtual}.`
            : "Preparando arquivo ZIP para download.",
        });
      },
      config,
    );

    atualizarJob(jobId, {
      status: "gerando ZIP",
      percentual: 99,
      mensagem: "Preparando arquivo ZIP para download.",
    });

    atualizarJob(jobId, {
      status: "concluido",
      percentual: 100,
      totalImagens: resultado.relatorio.totalImagens,
      lotesProcessados: resultado.relatorio.lotesProcessados,
      relatorio: resultado.relatorio,
      zipBuffer: resultado.buffer,
      filename: `${job.nomePastaLeilao}.zip`,
      mensagem: "ZIP pronto para download.",
    });
  } catch (error) {
    const mensagem = erroAmigavel(error);
    atualizarJob(jobId, {
      status: "erro",
      erro: mensagem,
      mensagem,
    });
  }
}

function responderZipDireto(jobId: string, imagensSelecionadas: string[]) {
  const job = obterJob(jobId);
  if (!job?.leilaoId || !job.nomePastaLeilao || !job.fotos) {
    return jsonCors(
      {
        error: "A lista de fotos desta extracao nao esta disponivel. Liste as fotos novamente antes de baixar.",
      },
      { status: 404 },
    );
  }

  const config = obterConfigDownload(job.extratorId);
  const selecionadas = new Set(imagensSelecionadas);
  const nomePasta = sanitizarNomePasta(job.nomePastaLeilao);
  const filename = `${nomePasta}.zip`;
  const archive = archiver("zip", { store: true, zlib: { level: 0 } });
  const stream = Readable.toWeb(archive) as ReadableStream<Uint8Array>;

  void (async () => {
    const relatorio = {
      leilaoId: job.leilaoId,
      totalLotes: job.fotos?.length ?? 0,
      lotesProcessados: 0,
      totalImagens: 0,
      lotesSemImagem: [] as Array<string | number>,
      erros: [] as Array<{ lote?: string | number; tipo: string; url?: string; mensagem: string }>,
    };

    try {
      for (const lote of job.fotos ?? []) {
        const imagens = lote.imagens.filter((imagem) => selecionadas.has(imagem.id));
        const loteNomeArquivo = sanitizarNomePasta(lote.numero);

        if (imagens.length === 0) {
          relatorio.lotesSemImagem.push(lote.numero);
          relatorio.lotesProcessados += 1;
          continue;
        }

        for (const [index, imagem] of imagens.entries()) {
          try {
            const arquivo = await baixarImagem(imagem.url, undefined, config);
            const extensao = extensaoImagem(imagem.url, arquivo.contentType);
            archive.append(Buffer.from(arquivo.buffer), {
              name: `${nomePasta}/${loteNomeArquivo}${indiceParaLetras(index)}${extensao}`,
            });
            relatorio.totalImagens += 1;
          } catch (error) {
            relatorio.erros.push({
              lote: lote.numero,
              tipo: "download_imagem",
              url: imagem.url,
              mensagem: error instanceof Error ? error.message : "Erro ao baixar imagem",
            });
          }
        }

        relatorio.lotesProcessados += 1;
      }

      archive.append(JSON.stringify(relatorio, null, 2), { name: `${nomePasta}/relatorio.json` });
      await archive.finalize();
    } catch (error) {
      archive.destroy(error instanceof Error ? error : new Error("Erro ao gerar ZIP."));
    }
  })();

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();

    if (payload?.action === "baixar_zip_direto") {
      const body = baixarZipDiretoSchema.parse(payload);
      return responderZipDireto(body.jobId, body.imagensSelecionadas);
    }

    if (payload?.action === "gerar_zip") {
      const body = gerarZipSchema.parse(payload);
      const job = obterJob(body.jobId);
      if (!job) {
      return jsonCors(
          {
            error:
              "Extracao nao encontrada ou expirada. Em producao, tente iniciar novamente; se persistir, configure armazenamento persistente de jobs.",
          },
          { status: 404 },
        );
      }

      void executarGeracaoZip(body.jobId, body.imagensSelecionadas);
      return jsonCors(serializarJob(job), { status: 202 });
    }

    const body = iniciarSchema.parse(payload);
    validarExtrator(body.extrator);

    const job = criarJob();
    if (body.extrator === "parque-dos-leiloes") {
      validarUrlParque(body.urlLeilao);
      void executarListagemParqueDosLeiloes(job.id, body.urlLeilao);
    } else if (body.extrator === "rogerio-menezes") {
      validarUrlRogerioMenezes(body.urlLeilao);
      void executarListagemRogerioMenezes(job.id, body.urlLeilao);
    } else {
      validarUrlSuporteLeiloes(body.urlLeilao, body.extrator);
      void executarListagemSuporteLeiloes(job.id, body.urlLeilao, body.extrator);
    }

    return jsonCors(serializarJob(job), { status: 202 });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : "";
    const status = error instanceof z.ZodError ? 400 : mensagem.includes("ainda nao foi implementado") ? 501 : 500;
    const message =
      error instanceof z.ZodError ? "Selecione um extrator e informe um link valido." : erroAmigavel(error);

    return jsonCors({ error: message }, { status });
  }
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("health") === "1") {
    return jsonCors({ ok: true, runtime: "extrator-local-ou-vercel" }, { status: 200 });
  }

  const jobId = request.nextUrl.searchParams.get("jobId");
  const download = request.nextUrl.searchParams.get("download");

  if (!jobId) {
    return jsonCors({ error: "Informe o jobId." }, { status: 400 });
  }

  const job = obterJob(jobId);
  if (!job) {
    return jsonCors(
      {
        error:
          "Extracao nao encontrada ou expirada. Em producao, tente iniciar novamente; se persistir, configure armazenamento persistente de jobs.",
      },
      { status: 404 },
    );
  }

  if (download === "1") {
    if (job.status !== "concluido" || !job.zipBuffer) {
      return jsonCors({ error: "O ZIP ainda nao esta pronto." }, { status: 409 });
    }

    return new NextResponse(new Uint8Array(job.zipBuffer), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${job.filename || "fotos-leilao.zip"}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return jsonCors(serializarJob(job), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}
