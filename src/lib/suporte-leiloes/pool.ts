export async function mapComConcorrencia<T, R>(
  itens: T[],
  limite: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const resultados = new Array<R>(itens.length);
  let cursor = 0;

  async function executar() {
    while (cursor < itens.length) {
      const index = cursor;
      cursor += 1;
      resultados[index] = await worker(itens[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(Math.max(1, limite), itens.length) }, executar);
  await Promise.all(workers);
  return resultados;
}
