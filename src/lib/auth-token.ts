export const AUTH_COOKIE_NAME = "extrator_auth";

export type AuthSession = {
  userId: string;
  username: string;
  name: string;
  nick: string;
  email: string;
  sessionId: string;
  exp: number;
};

function obterTtlSegundos() {
  const valor = Number(process.env.APP_AUTH_TOKEN_TTL_SECONDS || process.env.AUTH_TOKEN_TTL_SECONDS || 60 * 60 * 4);
  return Number.isFinite(valor) && valor > 0 ? valor : 60 * 60 * 4;
}

export const AUTH_MAX_AGE_SECONDS = obterTtlSegundos();

function base64UrlEncode(input: string | ArrayBuffer) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(input: string) {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new TextDecoder().decode(bytes);
}

function obterAuthSecret() {
  const secret = process.env.APP_AUTH_SECRET;

  if (!secret || secret.length < 24) {
    throw new Error("Configure APP_AUTH_SECRET com uma chave de pelo menos 24 caracteres.");
  }

  return secret;
}

async function assinar(valor: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(obterAuthSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(valor));
  return base64UrlEncode(signature);
}

async function assinaturaValida(valor: string, assinatura: string) {
  const assinaturaEsperada = await assinar(valor);
  if (assinatura.length !== assinaturaEsperada.length) {
    return false;
  }

  let diferenca = 0;
  for (let index = 0; index < assinatura.length; index += 1) {
    diferenca |= assinatura.charCodeAt(index) ^ assinaturaEsperada.charCodeAt(index);
  }

  return diferenca === 0;
}

export async function criarTokenSessao(payload: Omit<AuthSession, "exp">) {
  const session: AuthSession = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + AUTH_MAX_AGE_SECONDS,
  };
  const payloadEncoded = base64UrlEncode(JSON.stringify(session));
  const signature = await assinar(payloadEncoded);
  return `${payloadEncoded}.${signature}`;
}

export async function verificarToken(token?: string | null): Promise<AuthSession | null> {
  if (!token) {
    return null;
  }

  const [payloadEncoded, signature, extra] = token.split(".");
  if (extra || !payloadEncoded || !signature || !(await assinaturaValida(payloadEncoded, signature))) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(payloadEncoded)) as AuthSession;
    if (
      !payload.userId ||
      !payload.username ||
      !payload.name ||
      !payload.nick ||
      !payload.email ||
      !payload.sessionId ||
      !payload.exp ||
      payload.exp < Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function extrairBearerToken(authorization?: string | null) {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

export function bearerTokenHabilitado() {
  return process.env.APP_AUTH_ACCEPT_BEARER_TOKEN === "true";
}

export function exporBearerTokenHabilitado() {
  return process.env.APP_AUTH_EXPOSE_BEARER_TOKEN === "true";
}
