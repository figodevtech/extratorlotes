import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validarSessao } from "@/lib/auth-server";
import { AUTH_COOKIE_NAME, exporBearerTokenHabilitado } from "@/lib/auth-token";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  const session = await validarSessao(token);

  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    username: session.username,
    name: session.name,
    nick: session.nick,
    email: session.email,
    token: exporBearerTokenHabilitado() ? token : null,
  });
}
