import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, bearerTokenHabilitado, extrairBearerToken, verificarToken } from "@/lib/auth-token";
import { corsHeaders } from "@/lib/cors";

function respostaApiNaoAutenticada() {
  return NextResponse.json(
    { error: "Sessao expirada. Faca login novamente." },
    {
      status: 401,
      headers: corsHeaders(),
    },
  );
}

export async function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  const isLoginPage = pathname === "/login";
  const isAuthApi = pathname.startsWith("/api/auth/");
  const isExtractorApi = pathname === "/api/extrair-fotos-leilao";
  const token =
    request.cookies.get(AUTH_COOKIE_NAME)?.value ||
    (bearerTokenHabilitado() ? extrairBearerToken(request.headers.get("authorization")) : null);
  const session = await verificarToken(token);

  if (isAuthApi || pathname.startsWith("/_next") || pathname === "/favicon.ico") {
    return NextResponse.next();
  }

  if (isExtractorApi && request.method === "OPTIONS") {
    return NextResponse.next();
  }

  if (isExtractorApi && searchParams.get("health") === "1") {
    return NextResponse.next();
  }

  if (isLoginPage) {
    return NextResponse.next();
  }

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return respostaApiNaoAutenticada();
    }

    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/login", "/api/extrair-fotos-leilao"],
};
