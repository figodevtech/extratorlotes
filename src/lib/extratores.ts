export const extratores = [
  { id: "leiloes-pb", nome: "Leilões PB", implementado: true },
  { id: "golden-lance", nome: "Golden Lance", implementado: true },
  { id: "parque-dos-leiloes", nome: "Parque dos Leilões", implementado: true },
  { id: "rogerio-menezes", nome: "Rogério Menezes", implementado: true },
] as const;

export type ExtratorId = (typeof extratores)[number]["id"];

export function obterExtrator(id: string) {
  return extratores.find((extrator) => extrator.id === id);
}
