const DEFAULT_DEV_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"];

function obterAllowedOrigins() {
  const configured = process.env.APP_ALLOWED_ORIGINS || process.env.ALLOWED_ORIGINS || "";
  return configured
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function corsHeaders(origin?: string | null) {
  const allowedOrigins = obterAllowedOrigins();
  const origins = process.env.NODE_ENV === "production" ? allowedOrigins : [...allowedOrigins, ...DEFAULT_DEV_ORIGINS];
  const originPermitida = origin && origins.includes(origin) ? origin : null;

  return {
    ...(originPermitida ? { "Access-Control-Allow-Origin": originPermitida, Vary: "Origin" } : {}),
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Expose-Headers": "Content-Disposition",
    "Access-Control-Max-Age": "86400",
  };
}
