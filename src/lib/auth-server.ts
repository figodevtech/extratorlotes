import "server-only";
import { createClient } from "@supabase/supabase-js";
import { Pool } from "pg";
import {
  AUTH_COOKIE_NAME,
  bearerTokenHabilitado,
  criarTokenSessao,
  extrairBearerToken,
  verificarToken,
  type AuthSession,
} from "./auth-token";

type UsuarioResolvido = {
  id: string;
  email: string;
  nick: string;
  name: string;
};

const globalAuth = globalThis as typeof globalThis & {
  extratorAuthPool?: Pool;
  extratorAuthSchemaReady?: Promise<void>;
};

function obterSupabaseUrl() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.DATABASE_URL;
  if (!url?.startsWith("https://")) {
    throw new Error("Configure SUPABASE_URL ou DATABASE_URL com a URL HTTPS do projeto Supabase.");
  }
  return url;
}

function obterSupabaseKey() {
  const key =
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.DATABASE_PUBLISHABLE_KEY;
  if (!key) {
    throw new Error("Configure SUPABASE_ANON_KEY ou DATABASE_PUBLISHABLE_KEY.");
  }
  return key;
}

function obterDatabaseUrl() {
  const url =
    process.env.DATABASE_DIRECT_CONECTION_STRING ||
    process.env.DATABASE_DIRECT_CONNECTION_STRING ||
    process.env.DATABASE_SESSION_POOLER ||
    process.env.DATABASE_TRANSACTION_POOLER;
  if (!url) {
    throw new Error("Configure DATABASE_DIRECT_CONECTION_STRING com a conexao Postgres do Supabase.");
  }
  return url;
}

function db() {
  if (!globalAuth.extratorAuthPool) {
    globalAuth.extratorAuthPool = new Pool({
      connectionString: obterDatabaseUrl(),
      ssl: { rejectUnauthorized: false },
      max: 3,
    });
  }

  return globalAuth.extratorAuthPool;
}

async function garantirSchemaAuth() {
  globalAuth.extratorAuthSchemaReady ??= db().query(`
    create table if not exists public.app_auth_sessions (
      user_id uuid primary key references auth.users(id) on delete cascade,
      session_id text not null,
      updated_at timestamptz not null default now()
    );
    create table if not exists public.app_users (
      user_id uuid primary key references auth.users(id) on delete cascade,
      nick text not null unique,
      name text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create or replace function public.handle_new_auth_user()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $$
    declare
      base_nick text;
      final_nick text;
      final_name text;
      suffix integer := 0;
    begin
      base_nick := lower(regexp_replace(
        coalesce(
          new.raw_user_meta_data->>'nick',
          new.raw_user_meta_data->>'username',
          new.raw_user_meta_data->>'nickname',
          split_part(new.email, '@', 1)
        ),
        '[^a-zA-Z0-9_.-]+',
        '-',
        'g'
      ));

      base_nick := trim(both '-' from coalesce(nullif(base_nick, ''), 'usuario'));
      final_nick := base_nick;

      while exists (select 1 from public.app_users where nick = final_nick) loop
        suffix := suffix + 1;
        final_nick := base_nick || '-' || suffix;
      end loop;

      final_name := trim(coalesce(
        new.raw_user_meta_data->>'name',
        new.raw_user_meta_data->>'full_name',
        new.raw_user_meta_data->>'display_name',
        split_part(new.email, '@', 1)
      ));

      insert into public.app_users (user_id, nick, name)
      values (new.id, final_nick, coalesce(nullif(final_name, ''), final_nick))
      on conflict (user_id) do nothing;

      return new;
    end;
    $$;

    drop trigger if exists on_auth_user_created_create_app_user on auth.users;
    create trigger on_auth_user_created_create_app_user
      after insert on auth.users
      for each row execute function public.handle_new_auth_user();
    alter table public.app_auth_sessions enable row level security;
    alter table public.app_users enable row level security;
    revoke all on table public.app_auth_sessions from anon, authenticated;
    revoke all on table public.app_users from anon, authenticated;
    revoke all on function public.handle_new_auth_user() from public;
  `).then(() => undefined);

  return globalAuth.extratorAuthSchemaReady;
}

function nickDoUsuario(email: string, metadata: Record<string, unknown> | null) {
  const nick =
    metadata?.nick ||
    metadata?.username ||
    metadata?.nickname ||
    metadata?.name ||
    email.split("@")[0];
  return String(nick).trim();
}

function nomeDoUsuario(email: string, metadata: Record<string, unknown> | null) {
  const nome = metadata?.full_name || metadata?.name || metadata?.display_name || email.split("@")[0];
  return String(nome).trim();
}

export async function resolverUsuarioPorIdentificador(identificador: string): Promise<UsuarioResolvido | null> {
  const valor = identificador.trim().toLowerCase();
  if (!valor) {
    return null;
  }

  const result = await db().query<{
    id: string;
    email: string;
    raw_user_meta_data: Record<string, unknown> | null;
    app_nick: string | null;
    app_name: string | null;
  }>(
    `
      select
        users.id,
        users.email,
        users.raw_user_meta_data,
        app_users.nick as app_nick,
        app_users.name as app_name
      from auth.users
      left join public.app_users on app_users.user_id = users.id
      where
        lower(users.email) = $1
        or lower(coalesce(app_users.nick, '')) = $1
        or lower(coalesce(users.raw_user_meta_data->>'nick', '')) = $1
        or lower(coalesce(users.raw_user_meta_data->>'username', '')) = $1
        or lower(coalesce(users.raw_user_meta_data->>'nickname', '')) = $1
      order by users.created_at asc
      limit 2
    `,
    [valor],
  );

  if (result.rowCount !== 1) {
    return null;
  }

  const usuario = result.rows[0];
  return {
    id: usuario.id,
    email: usuario.email,
    nick: usuario.app_nick || nickDoUsuario(usuario.email, usuario.raw_user_meta_data),
    name: usuario.app_name || nomeDoUsuario(usuario.email, usuario.raw_user_meta_data),
  };
}

export async function autenticarUsuario(identificador: string, password: string) {
  await garantirSchemaAuth();
  const usuario = await resolverUsuarioPorIdentificador(identificador);
  if (!usuario) {
    return null;
  }

  const supabase = createClient(obterSupabaseUrl(), obterSupabaseKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { error } = await supabase.auth.signInWithPassword({
    email: usuario.email,
    password,
  });

  if (error) {
    return null;
  }

  const sessionId = crypto.randomUUID();
  await db().query(
    `
      insert into public.app_auth_sessions (user_id, session_id, updated_at)
      values ($1, $2, now())
      on conflict (user_id)
      do update set session_id = excluded.session_id, updated_at = now()
    `,
    [usuario.id, sessionId],
  );

  const token = await criarTokenSessao({
    userId: usuario.id,
    username: usuario.name,
    name: usuario.name,
    nick: usuario.nick,
    email: usuario.email,
    sessionId,
  });

  return { token, username: usuario.name, name: usuario.name, nick: usuario.nick, email: usuario.email };
}

export async function validarSessao(token?: string | null): Promise<AuthSession | null> {
  await garantirSchemaAuth();
  const session = await verificarToken(token);
  if (!session) {
    return null;
  }

  const result = await db().query<{ session_id: string }>(
    "select session_id from public.app_auth_sessions where user_id = $1",
    [session.userId],
  );

  if (result.rowCount !== 1 || result.rows[0].session_id !== session.sessionId) {
    return null;
  }

  return session;
}

export async function invalidarSessao(token?: string | null) {
  const session = await verificarToken(token);
  if (!session) {
    return;
  }

  await garantirSchemaAuth();
  await db().query("delete from public.app_auth_sessions where user_id = $1 and session_id = $2", [
    session.userId,
    session.sessionId,
  ]);
}

export function extrairTokenRequest(request: Request & { cookies?: { get: (name: string) => { value: string } | undefined } }) {
  const cookieToken = request.cookies?.get(AUTH_COOKIE_NAME)?.value;
  if (cookieToken) {
    return cookieToken;
  }

  if (!bearerTokenHabilitado()) {
    return null;
  }

  return extrairBearerToken(request.headers.get("authorization"));
}
