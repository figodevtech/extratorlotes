import { NextResponse } from "next/server";
import { invalidarSessao } from "@/lib/auth-server";
import { AUTH_COOKIE_NAME } from "@/lib/auth-token";

export async function POST(request: Request) {
  const token = request.headers.get("cookie")?.match(new RegExp(`${AUTH_COOKIE_NAME}=([^;]+)`))?.[1];
  await invalidarSessao(token ? decodeURIComponent(token) : null).catch(() => undefined);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
