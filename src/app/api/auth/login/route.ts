import { NextResponse } from "next/server";
import { z } from "zod";
import { autenticarUsuario } from "@/lib/auth-server";
import { AUTH_COOKIE_NAME, AUTH_MAX_AGE_SECONDS, exporBearerTokenHabilitado } from "@/lib/auth-token";
import { rateLimit } from "@/lib/rate-limit";

const loginSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const body = loginSchema.parse(await request.json());
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "local";
    const rate = rateLimit(`login:${ip}:${body.identifier.toLowerCase()}`, 5, 10 * 60 * 1000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Muitas tentativas de login. Tente novamente em alguns minutos." },
        {
          status: 429,
          headers: { "Retry-After": String(rate.retryAfterSeconds) },
        },
      );
    }

    const usuario = await autenticarUsuario(body.identifier, body.password);

    if (!usuario) {
      return NextResponse.json({ error: "Usuario, email ou senha invalidos." }, { status: 401 });
    }

    const response = NextResponse.json({
      ok: true,
      username: usuario.username,
      name: usuario.name,
      nick: usuario.nick,
      email: usuario.email,
      token: exporBearerTokenHabilitado() ? usuario.token : null,
    });
    response.cookies.set(AUTH_COOKIE_NAME, usuario.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: AUTH_MAX_AGE_SECONDS,
    });

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nao foi possivel fazer login.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
