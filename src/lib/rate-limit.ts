type EntradaRateLimit = {
  count: number;
  resetAt: number;
};

const globalRateLimit = globalThis as typeof globalThis & {
  extratorRateLimit?: Map<string, EntradaRateLimit>;
};

const store = globalRateLimit.extratorRateLimit ?? new Map<string, EntradaRateLimit>();
globalRateLimit.extratorRateLimit = store;

export function rateLimit(key: string, limite: number, janelaMs: number) {
  const now = Date.now();
  const atual = store.get(key);

  if (!atual || atual.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + janelaMs });
    limparExpirados(now);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  atual.count += 1;
  if (atual.count > limite) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((atual.resetAt - now) / 1000),
    };
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

function limparExpirados(now: number) {
  for (const [key, entrada] of store) {
    if (entrada.resetAt <= now) {
      store.delete(key);
    }
  }
}
