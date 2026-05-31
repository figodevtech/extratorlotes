export const extratores = [
  { id: "leiloes-pb", nome: "Leilões PB", implementado: true },
  { id: "golden-lance", nome: "Golden Lance", implementado: true },
  { id: "rogerio-menezes", nome: "Rogério Menezes", implementado: false },
] as const;

export type ExtratorId = (typeof extratores)[number]["id"];

export function obterExtrator(id: string) {
  return extratores.find((extrator) => extrator.id === id);
}
