"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { AlertCircle, Check, Download, Images, Loader2, LogOut } from "lucide-react";
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

function intervaloPolling(status: Status) {
  return status === "gerando ZIP" ? 2500 : 1000;
}

function contarSelecionadas(selecionadas: Set<string>) {
  return selecionadas.size;
}

function obterIdsPrimeiras(fotos: LoteFotos[], quantidade: number) {
  return fotos.flatMap((lote) => lote.imagens.slice(0, quantidade).map((imagem) => imagem.id));
}

const API_PATH = "/api/extrair-fotos-leilao";
const LOCAL_API_ENDPOINTS = [
  "http://127.0.0.1:3000/api/extrair-fotos-leilao",
  "http://localhost:3000/api/extrair-fotos-leilao",
];

function montarApiUrl(endpoint: string, query = "") {
  return endpoint ? `${endpoint}${query}` : `${API_PATH}${query}`;
}

function extrairFilename(response: Response) {
  const contentDisposition = response.headers.get("content-disposition");
  const match = contentDisposition?.match(/filename="?([^"]+)"?/i);
  return match?.[1] || "fotos-leilao.zip";
}

function montarAuthHeaders(authToken: string, headers?: HeadersInit): HeadersInit {
  return {
    ...headers,
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
  };
}

async function endpointLocalDisponivel(endpoint: string, authToken: string) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 900);

  try {
    const response = await fetch(`${endpoint}?health=1`, {
      cache: "no-store",
      headers: montarAuthHeaders(authToken),
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function detectarApiEndpoint(authToken: string) {
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    return "";
  }

  if (!authToken) {
    return "";
  }

  for (const endpoint of LOCAL_API_ENDPOINTS) {
    if (await endpointLocalDisponivel(endpoint, authToken)) {
      return endpoint;
    }
  }

  return "";
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
  const [apiEndpoint, setApiEndpoint] = useState("");
  const [usuario, setUsuario] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [sessaoChecada, setSessaoChecada] = useState(false);
  const arrastoRef = useRef<{
    ativo: boolean;
    pointerId: number | null;
    imagensAlternadas: Set<string>;
  }>({
    ativo: false,
    pointerId: null,
    imagensAlternadas: new Set(),
  });
  const downloadIniciadoRef = useRef(false);
  const objectUrlRef = useRef("");

  const leilaoId = useMemo(() => job?.leilaoId || extrairIdLeilao(urlLeilao), [job?.leilaoId, urlLeilao]);
  const isLoading = !["aguardando", "concluido", "erro"].includes(status);
  const sessaoPronta = sessaoChecada && Boolean(usuario);
  const fotos = job?.fotos ?? [];
  const totalFotos = fotos.reduce((total, lote) => total + lote.imagens.length, 0);
  const totalSelecionadas = contarSelecionadas(selecionadas);

  function redirecionarLogin() {
    setUsuario("");
    setAuthToken("");
    setSessaoChecada(false);
    window.location.replace("/login");
  }

  useEffect(() => {
    async function carregarSessao() {
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        if (!response.ok) {
          redirecionarLogin();
          return;
        }

        const payload = (await response.json()) as {
          username?: string;
          name?: string;
          nick?: string;
          email?: string;
          token?: string | null;
        };
        setUsuario(payload.name || payload.username || payload.nick || payload.email || "");
        setAuthToken(payload.token || "");
        setSessaoChecada(true);
      } catch {
        redirecionarLogin();
      }
    }

    void carregarSessao();
    const interval = window.setInterval(carregarSessao, 10000);

    return () => window.clearInterval(interval);
  }, []);

  function aplicarJob(proximoJob: JobResponse, endpoint = apiEndpoint) {
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
      const url = montarApiUrl(endpoint, `?jobId=${proximoJob.id}&download=1`);
      setDownloadUrl(url);

      if (!downloadIniciadoRef.current) {
        downloadIniciadoRef.current = true;
        const link = document.createElement("a");
        link.href = url;
        link.download = proximoJob.filename || "fotos-leilao.zip";
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
    }
  }

  async function consultarJob(jobId: string, endpoint = apiEndpoint) {
    const response = await fetch(montarApiUrl(endpoint, `?jobId=${jobId}`), {
      cache: "no-store",
      headers: montarAuthHeaders(authToken),
    });

    if (!response.ok) {
      if (response.status === 401) {
        redirecionarLogin();
      }
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error || "Nao foi possivel consultar o progresso.");
    }

    return (await response.json()) as JobResponse;
  }

  async function acompanharJob(jobId: string, endpoint = apiEndpoint) {
    let proximoJob = await consultarJob(jobId, endpoint);
    aplicarJob(proximoJob, endpoint);

    while (!["concluido", "erro"].includes(proximoJob.status)) {
      await sleep(intervaloPolling(proximoJob.status));
      proximoJob = await consultarJob(jobId, endpoint);
      aplicarJob(proximoJob, endpoint);
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
    downloadIniciadoRef.current = false;
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = "";
    }

    if (extrator === "leiloes-pb" && !leilaoId) {
      setStatus("erro");
      setErro("Informe um link valido da Leiloes PB contendo o ID apos /leilao/.");
      return;
    }

    try {
      const endpoint = await detectarApiEndpoint(authToken);
      setApiEndpoint(endpoint);
      setStatus("autenticando");
      setProgress(2);

      const response = await fetch(montarApiUrl(endpoint), {
        method: "POST",
        headers: montarAuthHeaders(authToken, { "Content-Type": "application/json" }),
        body: JSON.stringify({ extrator, urlLeilao }),
      });

      if (!response.ok) {
        if (response.status === 401) {
          redirecionarLogin();
          return;
        }
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || "Nao foi possivel iniciar a listagem.");
      }

      const proximoJob = (await response.json()) as JobResponse;
      aplicarJob(proximoJob, endpoint);
      await acompanharJob(proximoJob.id, endpoint);
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
      setProgress(99);
      downloadIniciadoRef.current = false;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = "";
      }

      setJob((atual) =>
        atual
          ? {
              ...atual,
              status: "gerando ZIP",
              percentual: 99,
              mensagem: "Preparando arquivo ZIP para download.",
              filename: "",
            }
          : atual,
      );

      const endpoint = apiEndpoint;
      const response = await fetch(montarApiUrl(endpoint), {
        method: "POST",
        headers: montarAuthHeaders(authToken, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          action: "baixar_zip_direto",
          jobId: job.id,
          imagensSelecionadas: Array.from(selecionadas),
        }),
      });

      if (!response.ok) {
        if (response.status === 401) {
          redirecionarLogin();
          return;
        }
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || "Nao foi possivel iniciar o download.");
      }

      const arquivo = await response.blob();
      const proximoFilename = extrairFilename(response);
      const url = URL.createObjectURL(arquivo);
      objectUrlRef.current = url;
      downloadIniciadoRef.current = true;
      setDownloadUrl(url);
      setFilename(proximoFilename);
      setStatus("concluido");
      setProgress(100);
      setJob((atual) =>
        atual
          ? {
              ...atual,
              status: "concluido",
              percentual: 100,
              filename: proximoFilename,
              mensagem: "ZIP pronto para download.",
            }
          : atual,
      );

      const link = document.createElement("a");
      link.href = url;
      link.download = proximoFilename;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      setStatus("erro");
      setProgress(0);
      setErro(error instanceof Error ? error.message : "Erro inesperado ao gerar o ZIP.");
    }
  }

  async function sair() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    setUsuario("");
    setAuthToken("");
    setSessaoChecada(false);
    window.location.href = "/login";
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

  function desmarcarTodas() {
    setSelecionadas(new Set());
    setPrimeiras("");
  }

  function selecionarPrimeiras(quantidade: number) {
    setPrimeiras(quantidade);
    setSelecionadas(new Set(obterIdsPrimeiras(fotos, quantidade)));
  }

  function alternarImagemNoArrasto(id: string) {
    if (arrastoRef.current.imagensAlternadas.has(id)) {
      return;
    }

    arrastoRef.current.imagensAlternadas.add(id);
    alternarImagem(id);
  }

  function iniciarArrastoImagem(event: React.PointerEvent<HTMLButtonElement>, id: string) {
    if (isLoading || (event.pointerType === "mouse" && event.button !== 0)) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    arrastoRef.current = {
      ativo: true,
      pointerId: event.pointerId,
      imagensAlternadas: new Set(),
    };
    alternarImagemNoArrasto(id);
  }

  function continuarArrastoImagem(event: React.PointerEvent<HTMLButtonElement>) {
    if (!arrastoRef.current.ativo || arrastoRef.current.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    const elemento = document.elementFromPoint(event.clientX, event.clientY);
    const imagem = elemento?.closest<HTMLElement>("[data-imagem-id]");
    const id = imagem?.dataset.imagemId;

    if (id) {
      alternarImagemNoArrasto(id);
    }
  }

  function finalizarArrastoImagem(event: React.PointerEvent<HTMLButtonElement>) {
    if (arrastoRef.current.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    arrastoRef.current = {
      ativo: false,
      pointerId: null,
      imagensAlternadas: new Set(),
    };
  }

  return (
    <main className="min-h-screen px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
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
          </div>
          <div className="flex items-center gap-3">
            {usuario ? <span className="text-sm text-muted-foreground">{usuario}</span> : null}
            <Button variant="outline" onClick={sair} className="sm:w-fit">
              <LogOut className="h-4 w-4" />
              Sair
            </Button>
          </div>
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
                disabled={isLoading || !sessaoPronta}
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
                  disabled={isLoading || !sessaoPronta}
                />
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Button onClick={listarFotos} disabled={isLoading || !sessaoPronta} className="sm:w-fit">
                  {isLoading && status !== "gerando ZIP" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Images className="h-4 w-4" />
                  )}
                  Listar fotos
                </Button>
                {fotos.length > 0 && !downloadUrl ? (
                  <Button
                    onClick={iniciarDownload}
                    disabled={isLoading || !sessaoPronta || totalSelecionadas === 0}
                    className="sm:w-fit"
                  >
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
                  <Button variant="outline" onClick={desmarcarTodas} disabled={isLoading || totalSelecionadas === 0}>
                    Desmarcar Todas
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
                            data-imagem-id={imagem.id}
                            className={cn(
                              "relative aspect-[4/3] touch-none select-none overflow-hidden rounded-md border bg-muted text-left transition",
                              ativa
                                ? "border-primary ring-2 ring-primary"
                                : "border-border opacity-60 hover:opacity-100",
                            )}
                            onPointerDown={(event) => iniciarArrastoImagem(event, imagem.id)}
                            onPointerMove={continuarArrastoImagem}
                            onPointerUp={finalizarArrastoImagem}
                            onPointerCancel={finalizarArrastoImagem}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                alternarImagem(imagem.id);
                              }
                            }}
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
