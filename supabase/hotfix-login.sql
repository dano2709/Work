-- Oprava přihlášení pro Supabase: funkce pgcrypto jsou ve schématu extensions.
-- Spusť tento skript v Supabase SQL Editoru a potom stránku obnov přes Ctrl + F5.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create or replace function public.current_app_user(p_token text)
returns public.app_users
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user public.app_users%rowtype;
begin
  if p_token is null or length(p_token) < 20 then
    raise exception 'Neplatné nebo expirované přihlášení.';
  end if;

  select u.*
  into v_user
  from public.app_sessions s
  join public.app_users u on u.id = s.user_id
  where s.token_hash = encode(digest(p_token, 'sha256'), 'hex')
    and s.expires_at > now()
  limit 1;

  if v_user.id is null then
    raise exception 'Neplatné nebo expirované přihlášení.';
  end if;

  return v_user;
end;
$$;

create or replace function public.login_user(p_username text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user public.app_users%rowtype;
  v_token text;
begin
  select *
  into v_user
  from public.app_users
  where lower(username) = lower(trim(p_username))
  limit 1;

  if v_user.id is null or v_user.password_hash <> crypt(p_password, v_user.password_hash) then
    raise exception 'Neplatné přihlašovací údaje.';
  end if;

  delete from public.app_sessions where expires_at <= now();

  v_token := encode(gen_random_bytes(32), 'hex');

  insert into public.app_sessions (user_id, token_hash, expires_at)
  values (v_user.id, encode(digest(v_token, 'sha256'), 'hex'), now() + interval '30 days');

  return jsonb_build_object(
    'token', v_token,
    'user', jsonb_build_object(
      'id', v_user.id,
      'name', v_user.name,
      'username', v_user.username,
      'role', v_user.role
    )
  );
end;
$$;

create or replace function public.logout_user(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  delete from public.app_sessions
  where token_hash = encode(digest(p_token, 'sha256'), 'hex');
  return true;
end;
$$;

grant execute on function public.current_app_user(text) to anon, authenticated;
grant execute on function public.login_user(text, text) to anon, authenticated;
grant execute on function public.logout_user(text) to anon, authenticated;
