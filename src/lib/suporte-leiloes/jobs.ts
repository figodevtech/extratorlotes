import type { RelatorioExtracao } from "./zip";

export type FotoEncontrada = {
  id: string;
  url: string;
};

export type LoteFotos = {
  loteId: string | number;
  numero: string | number;
  imagens: FotoEncontrada[];
};

export type JobStatus =
  | "aguardando"
  | "autenticando"
  | "buscando lotes"
  | "baixando imagens"
  | "gerando ZIP"
  | "concluido"
  | "erro";

export type ExtracaoJob = {
  id: string;
  status: JobStatus;
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
  zipBuffer?: Buffer;
  relatorio?: RelatorioExtracao;
  createdAt: number;
  updatedAt: number;
};

type JobPatch = Partial<Omit<ExtracaoJob, "id" | "createdAt">>;

const globalJobs = globalThis as typeof globalThis & {
  suporteLeiloesJobs?: Map<string, ExtracaoJob>;
};

export const jobs = globalJobs.suporteLeiloesJobs ?? new Map<string, ExtracaoJob>();
globalJobs.suporteLeiloesJobs = jobs;

export function criarJob(): ExtracaoJob {
  const now = Date.now();
  const job: ExtracaoJob = {
    id: crypto.randomUUID(),
    status: "aguardando",
    totalLotes: 0,
    lotesProcessados: 0,
    totalImagens: 0,
    percentual: 0,
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(job.id, job);
  limparJobsAntigos();
  return job;
}

export function obterJob(jobId: string) {
  return jobs.get(jobId);
}

export function atualizarJob(jobId: string, patch: JobPatch) {
  const job = jobs.get(jobId);
  if (!job) {
    return;
  }

  Object.assign(job, patch, { updatedAt: Date.now() });
}

export function serializarJob(job: ExtracaoJob) {
  return {
    id: job.id,
    status: job.status,
    leilaoId: job.leilaoId,
    totalLotes: job.totalLotes,
    lotesProcessados: job.lotesProcessados,
    totalImagens: job.totalImagens,
    loteAtual: job.loteAtual,
    percentual: job.percentual,
    mensagem: job.mensagem,
    erro: job.erro,
    filename: job.filename,
    nomePastaLeilao: job.nomePastaLeilao,
    fotos: job.fotos,
    downloadDisponivel: Boolean(job.zipBuffer),
    relatorio: job.relatorio,
  };
}

function limparJobsAntigos() {
  const limite = Date.now() - 1000 * 60 * 60;
  for (const [id, job] of jobs) {
    if (job.updatedAt < limite) {
      jobs.delete(id);
    }
  }
}
