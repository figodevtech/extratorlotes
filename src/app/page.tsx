"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { AlertCircle, Check, Download, Images, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { extratores, type ExtratorId } from "@/lib/extratores";
import { cn } from "@/lib/utils";

type Status =
  | "aguardando"
  | "autenticando"
  | "buscando lotes"
  | "baixando imagens"
  | "gerando ZIP"
  | "concluido"
  | "erro";

type Relatorio = {
  leilaoId: string;
  totalLotes: number;
  lotesProcessados: number;
  totalImagens: number;
  lotesSemImagem: Array<string | number>;
  erros: Array<{ lote?: string | number; tipo: string; url?: string; mensagem: string }>;
};

type FotoEncontrada = {
  id: string;
  url: string;
};

type LoteFotos = {
  loteId: string | number;
  numero: string | number;
  imagens: FotoEncontrada[];
};

type JobResponse = {
  id: string;
  status: Status;
  leilaoId?: string;
  totalLotes: number;
  lotesProcessados: number;
  totalImagens: number;
  loteAtual?: string | number;
  percentual: number;
  mensagem?: string;
  erro?: string;
  filename?: string;
  nomePastaLeilao?: string;
  fotos?: LoteFotos[];
  downloadDisponivel?: boolean;
  relatorio?: Relatorio;
};

function extrairIdLeilao(url: string): string | null {
  const match = url.match(/\/leilao\/(\d+)/);
  return match ? match[1] : null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function contarSelecionadas(selecionadas: Set<string>) {
  return selecionadas.size;
}

function obterIdsPrimeiras(fotos: LoteFotos[], quantidade: number) {
  return fotos.flatMap((lote) => lote.imagens.slice(0, quantidade).map((imagem) => imagem.id));
}

export default function Home() {
  const [extrator, setExtrator] = useState<ExtratorId>("leiloes-pb");
  const [urlLeilao, setUrlLeilao] = useState("");
  const [status, setStatus] = useState<Status>("aguardando");
  const [progress, setProgress] = useState(0);
  const [erro, setErro] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [filename, setFilename] = useState("");
  const [relatorio, setRelatorio] = useState<Relatorio | null>(null);
  const [job, setJob] = useState<JobResponse | null>(null);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [primeiras, setPrimeiras] = useState<number | "">(4);

  const leilaoId = useMemo(() => job?.leilaoId || extrairIdLeilao(urlLeilao), [job?.leilaoId, urlLeilao]);
  const isLoading = !["aguardando", "concluido", "erro"].includes(status);
  const fotos = job?.fotos ?? [];
  const totalFotos = fotos.reduce((total, lote) => total + lote.imagens.length, 0);
  const totalSelecionadas = contarSelecionadas(selecionadas);

  function aplicarJob(proximoJob: JobResponse) {
    setJob(proximoJob);
    setStatus(proximoJob.status);
    setProgress(proximoJob.percentual);
    setFilename(proximoJob.filename || "");

    if (proximoJob.relatorio) {
      setRelatorio(proximoJob.relatorio);
    }

    if (proximoJob.fotos) {
      const ids = obterIdsPrimeiras(proximoJob.fotos, 4);
      setSelecionadas((atual) => (atual.size > 0 ? atual : new Set(ids)));
    }

    if (proximoJob.status === "erro") {
      setErro(proximoJob.erro || proximoJob.mensagem || "Erro inesperado ao processar fotos.");
    }

    if (proximoJob.downloadDisponivel) {
      setDownloadUrl(`/api/extrair-fotos-leilao?jobId=${proximoJob.id}&download=1`);
    }
  }

  async function consultarJob(jobId: string) {
    const response = await fetch(`/api/extrair-fotos-leilao?jobId=${jobId}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error || "Nao foi possivel consultar o progresso.");
    }

    return (await response.json()) as JobResponse;
  }

  async function acompanharJob(jobId: string) {
    let proximoJob = await consultarJob(jobId);
    aplicarJob(proximoJob);

    while (!["concluido", "erro"].includes(proximoJob.status)) {
      await sleep(1000);
      proximoJob = await consultarJob(jobId);
      aplicarJob(proximoJob);
    }
  }

  async function listarFotos() {
    setErro("");
    setRelatorio(null);
    setDownloadUrl("");
    setFilename("");
    setJob(null);
    setSelecionadas(new Set());
    setPrimeiras(4);
    setProgress(0);

    if (extrator === "leiloes-pb" && !leilaoId) {
      setStatus("erro");
      setErro("Informe um link valido da Leiloes PB contendo o ID apos /leilao/.");
      return;
    }

    try {
      setStatus("autenticando");
      setProgress(2);

      const response = await fetch("/api/extrair-fotos-leilao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extrator, urlLeilao }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || "Nao foi possivel iniciar a listagem.");
      }

      const proximoJob = (await response.json()) as JobResponse;
      aplicarJob(proximoJob);
      await acompanharJob(proximoJob.id);
    } catch (error) {
      setStatus("erro");
      setProgress(0);
      setErro(error instanceof Error ? error.message : "Erro inesperado ao listar fotos.");
    }
  }

  async function iniciarDownload() {
    if (!job || totalSelecionadas === 0) {
      setErro("Selecione ao menos uma imagem para download.");
      return;
    }

    try {
      setErro("");
      setDownloadUrl("");
      setRelatorio(null);
      setStatus("gerando ZIP");
      setProgress(0);

      const response = await fetch("/api/extrair-fotos-leilao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "gerar_zip",
          jobId: job.id,
          imagensSelecionadas: Array.from(selecionadas),
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || "Nao foi possivel iniciar o download.");
      }

      const proximoJob = (await response.json()) as JobResponse;
      aplicarJob(proximoJob);
      await acompanharJob(proximoJob.id);
    } catch (error) {
      setStatus("erro");
      setProgress(0);
      setErro(error instanceof Error ? error.message : "Erro inesperado ao gerar o ZIP.");
    }
  }

  function alternarImagem(id: string) {
    setSelecionadas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) {
        proximo.delete(id);
      } else {
        proximo.add(id);
      }
      return proximo;
    });
  }

  function selecionarTodas() {
    setSelecionadas(new Set(fotos.flatMap((lote) => lote.imagens.map((imagem) => imagem.id))));
    setPrimeiras("");
  }

  function selecionarPrimeiras(quantidade: number) {
    setPrimeiras(quantidade);
    setSelecionadas(new Set(obterIdsPrimeiras(fotos, quantidade)));
  }

  return (
    <main className="min-h-screen px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-1 text-sm font-medium text-accent-foreground">
            <Images className="h-4 w-4" />
            Multi-leiloes
          </div>
          <h1 className="text-3xl font-semibold tracking-normal text-foreground sm:text-4xl">
            Extrator de fotos de lotes
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
            Liste as fotos, selecione as imagens desejadas e gere um ZIP no padrao configurado.
          </p>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <Card>
            <CardHeader>
              <CardTitle>Extracao</CardTitle>
              <CardDescription>Cada cliente pode ter um metodo proprio de extracao.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="extrator">
                  Cliente
                </label>
                <select
                  id="extrator"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  value={extrator}
                  onChange={(event) => setExtrator(event.target.value as ExtratorId)}
                  disabled={isLoading}
                >
                  {extratores.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.nome}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="urlLeilao">
                  Link do leilao
                </label>
                <Input
                  id="urlLeilao"
                  placeholder="Cole aqui o link do leilao"
                  value={urlLeilao}
                  onChange={(event) => setUrlLeilao(event.target.value)}
                  disabled={isLoading}
                />
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Button onClick={listarFotos} disabled={isLoading} className="sm:w-fit">
                  {isLoading && status !== "gerando ZIP" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Images className="h-4 w-4" />
                  )}
                  Listar fotos
                </Button>
                {fotos.length > 0 && !downloadUrl ? (
                  <Button onClick={iniciarDownload} disabled={isLoading || totalSelecionadas === 0} className="sm:w-fit">
                    {status === "gerando ZIP" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                    Iniciar download
                  </Button>
                ) : null}
                {downloadUrl ? (
                  <a
                    className={cn(
                      "inline-flex h-10 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground sm:w-fit",
                    )}
                    href={downloadUrl}
                    download={filename || "fotos-leilao.zip"}
                  >
                    <Download className="h-4 w-4" />
                    Baixar ZIP
                  </a>
                ) : null}
              </div>

              {erro ? (
                <div className="flex gap-2 rounded-md border border-destructive/30 bg-white p-3 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{erro}</span>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>O progresso acompanha listagem e geracao do ZIP.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium">{progress}%</span>
                  <span className="truncate text-muted-foreground">
                    {job?.mensagem || "Aguardando inicio da extracao."}
                  </span>
                </div>
                <Progress value={progress} />
              </div>

              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-md bg-muted p-3">
                  <dt className="text-muted-foreground">Cliente</dt>
                  <dd className="mt-1 font-semibold">
                    {extratores.find((item) => item.id === extrator)?.nome || "-"}
                  </dd>
                </div>
                <div className="rounded-md bg-muted p-3">
                  <dt className="text-muted-foreground">ID do leilao</dt>
                  <dd className="mt-1 font-semibold">{leilaoId || "-"}</dd>
                </div>
                <div className="rounded-md bg-muted p-3">
                  <dt className="text-muted-foreground">Status atual</dt>
                  <dd className="mt-1 font-semibold capitalize">{status}</dd>
                </div>
                <div className="rounded-md bg-muted p-3">
                  <dt className="text-muted-foreground">Lotes encontrados</dt>
                  <dd className="mt-1 font-semibold">{job?.totalLotes || relatorio?.totalLotes || "-"}</dd>
                </div>
                <div className="rounded-md bg-muted p-3">
                  <dt className="text-muted-foreground">Lote atual</dt>
                  <dd className="mt-1 font-semibold">{job?.loteAtual ?? "-"}</dd>
                </div>
                <div className="rounded-md bg-muted p-3">
                  <dt className="text-muted-foreground">Imagens encontradas</dt>
                  <dd className="mt-1 font-semibold">{totalFotos || job?.totalImagens || "-"}</dd>
                </div>
                <div className="rounded-md bg-muted p-3">
                  <dt className="text-muted-foreground">Selecionadas</dt>
                  <dd className="mt-1 font-semibold">{totalSelecionadas || "-"}</dd>
                </div>
                <div className="rounded-md bg-muted p-3">
                  <dt className="text-muted-foreground">Arquivo</dt>
                  <dd className="mt-1 truncate font-semibold">{filename || "-"}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </section>

        {fotos.length > 0 ? (
          <section className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold tracking-normal">Fotos encontradas</h2>
                <p className="text-sm text-muted-foreground">
                  Clique nas imagens para incluir ou remover do download.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:items-end">
                <p className="text-sm font-medium">
                  {totalSelecionadas} de {totalFotos} selecionadas
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" onClick={selecionarTodas} disabled={isLoading}>
                    Selecionar Todas
                  </Button>
                  <label className="flex items-center gap-2 text-sm font-medium">
                    Primeiras
                    <select
                      className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                      value={primeiras}
                      onChange={(event) => selecionarPrimeiras(Number(event.target.value))}
                      disabled={isLoading}
                    >
                      <option value="" disabled>
                        Escolha
                      </option>
                      {[1, 2, 3, 4, 5, 6, 7, 8].map((quantidade) => (
                        <option key={quantidade} value={quantidade}>
                          {quantidade}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            </div>

            {fotos.map((lote) => (
              <Card key={String(lote.loteId)}>
                <CardHeader>
                  <CardTitle>Lote {lote.numero}</CardTitle>
                  <CardDescription>{lote.imagens.length} imagem(ns) encontrada(s)</CardDescription>
                </CardHeader>
                <CardContent>
                  {lote.imagens.length > 0 ? (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                      {lote.imagens.map((imagem, index) => {
                        const ativa = selecionadas.has(imagem.id);

                        return (
                          <button
                            key={imagem.id}
                            type="button"
                            className={cn(
                              "relative aspect-[4/3] overflow-hidden rounded-md border bg-muted text-left transition",
                              ativa
                                ? "border-primary ring-2 ring-primary"
                                : "border-border opacity-60 hover:opacity-100",
                            )}
                            onClick={() => alternarImagem(imagem.id)}
                            aria-pressed={ativa}
                            disabled={isLoading}
                          >
                            <Image
                              src={imagem.url}
                              alt={`Lote ${lote.numero} foto ${index + 1}`}
                              className="object-cover"
                              loading="lazy"
                              fill
                              sizes="(min-width: 1024px) 16vw, (min-width: 768px) 25vw, (min-width: 640px) 33vw, 50vw"
                              unoptimized
                            />
                            {ativa ? (
                              <span className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
                                <Check className="h-4 w-4" />
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Nenhuma foto encontrada para este lote.</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </section>
        ) : null}

        {relatorio && (relatorio.lotesSemImagem.length > 0 || relatorio.erros.length > 0) ? (
          <Card>
            <CardHeader>
              <CardTitle>Relatorio</CardTitle>
              <CardDescription>O arquivo completo tambem foi incluido no ZIP como relatorio.json.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              {relatorio.lotesSemImagem.length > 0 ? (
                <p>Lotes sem fotos: {relatorio.lotesSemImagem.join(", ")}</p>
              ) : null}
              {relatorio.erros.slice(0, 5).map((item, index) => (
                <p key={`${item.tipo}-${index}`}>
                  {item.lote ? `Lote ${item.lote}: ` : ""}
                  {item.mensagem}
                </p>
              ))}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </main>
  );
}
