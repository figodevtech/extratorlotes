import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { obterExtrator, type ExtratorId } from "@/lib/extratores";
import { listarFotosParqueDosLeiloes, validarUrlParque } from "@/lib/parque-dos-leiloes/extrator";
import { listarFotosRogerioMenezes, validarUrlRogerioMenezes } from "@/lib/rogerio-menezes/extrator";
import { autenticarSuporteLeiloes } from "@/lib/suporte-leiloes/auth";
import { obterConfigSuporteLeiloes, type SuporteLeiloesConfig } from "@/lib/suporte-leiloes/config";
import { extrairUrlsDasImagens, sanitizarNomePasta } from "@/lib/suporte-leiloes/imagens";
import { atualizarJob, criarJob, obterJob, serializarJob } from "@/lib/suporte-leiloes/jobs";
import { buscarLoteDetalhado, buscarTodosOsLotes } from "@/lib/suporte-leiloes/lotes";
import { mapComConcorrencia } from "@/lib/suporte-leiloes/pool";
import { gerarZipFotosSelecionadas } from "@/lib/suporte-leiloes/zip";

export const runtime = "nodejs";
export const maxDuration = 300;

const iniciarSchema = z.object({
  extrator: z.enum(["leiloes-pb", "golden-lance", "parque-dos-leiloes", "rogerio-menezes"]),
  urlLeilao: z.string().url("Informe uma URL valida."),
});

const gerarZipSchema = z.object({
  action: z.literal("gerar_zip"),
  jobId: z.string().min(1),
  imagensSelecionadas: z.array(z.string()).min(1, "Selecione ao menos uma imagem."),
});

export function extrairIdLeilao(url: string): string | null {
  const match = url.match(/\/leilao\/(\d+)/);
  return match ? match[1] : null;
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
          mensagem: progresso.loteAtual ? `Baixando fotos do lote ${progresso.loteAtual}.` : "Gerando ZIP.",
        });
      },
      config,
    );

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

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();

    if (payload?.action === "gerar_zip") {
      const body = gerarZipSchema.parse(payload);
      const job = obterJob(body.jobId);
      if (!job) {
        return NextResponse.json({ error: "Extracao nao encontrada ou expirada." }, { status: 404 });
      }

      void executarGeracaoZip(body.jobId, body.imagensSelecionadas);
      return NextResponse.json(serializarJob(job), { status: 202 });
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

    return NextResponse.json(serializarJob(job), { status: 202 });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : "";
    const status = error instanceof z.ZodError ? 400 : mensagem.includes("ainda nao foi implementado") ? 501 : 500;
    const message =
      error instanceof z.ZodError ? "Selecione um extrator e informe um link valido." : erroAmigavel(error);

    return NextResponse.json({ error: message }, { status });
  }
}

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId");
  const download = request.nextUrl.searchParams.get("download");

  if (!jobId) {
    return NextResponse.json({ error: "Informe o jobId." }, { status: 400 });
  }

  const job = obterJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "Extracao nao encontrada ou expirada." }, { status: 404 });
  }

  if (download === "1") {
    if (job.status !== "concluido" || !job.zipBuffer) {
      return NextResponse.json({ error: "O ZIP ainda nao esta pronto." }, { status: 409 });
    }

    return new NextResponse(new Uint8Array(job.zipBuffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${job.filename || "fotos-leilao.zip"}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json(serializarJob(job), {
    headers: { "Cache-Control": "no-store" },
  });
}
