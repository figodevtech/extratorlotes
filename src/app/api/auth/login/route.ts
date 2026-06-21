import { NextResponse } from "next/server";
import { z } from "zod";
import { autenticarUsuario } from "@/lib/auth-server";
import { AUTH_COOKIE_NAME, AUTH_MAX_AGE_SECONDS, exporBearerTokenHabilitado } from "@/lib/auth-token";

const loginSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const body = loginSchema.parse(await request.json());
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
