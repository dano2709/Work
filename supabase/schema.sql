-- Supabase setup pro aplikaci „Přehled práce od Daniela Třetiny“
-- Postup:
-- 1) Otevři Supabase → SQL Editor.
-- 2) Vlož celý tento skript.
-- 3) Klikni na Run.
--
-- Testovací účty:
-- admin / admin123
-- manager / manager123

create extension if not exists pgcrypto;

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  username text not null unique,
  password_hash text not null,
  role text not null check (role in ('admin', 'manager')),
  created_at timestamptz not null default now()
);

create table if not exists public.app_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.calendar_notes (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  title text not null,
  content text not null,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.calendar_documents (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.calendar_notes(id) on delete cascade,
  file_name text not null,
  mime_type text,
  file_size bigint default 0,
  content_base64 text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  short_description text,
  full_description text,
  category text not null default 'idea' check (category in ('idea', 'in_progress', 'done')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  status text default 'Aktivní',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_checklist_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  text text not null,
  is_done boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_reviews (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  reviewer_user_id uuid not null references public.app_users(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, reviewer_user_id)
);

alter table public.app_users enable row level security;
alter table public.app_sessions enable row level security;
alter table public.calendar_notes enable row level security;
alter table public.calendar_documents enable row level security;
alter table public.projects enable row level security;
alter table public.project_checklist_items enable row level security;
alter table public.project_reviews enable row level security;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_calendar_notes_updated_at on public.calendar_notes;
create trigger set_calendar_notes_updated_at
before update on public.calendar_notes
for each row execute function public.set_updated_at();

drop trigger if exists set_projects_updated_at on public.projects;
create trigger set_projects_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

drop trigger if exists set_project_checklist_updated_at on public.project_checklist_items;
create trigger set_project_checklist_updated_at
before update on public.project_checklist_items
for each row execute function public.set_updated_at();

drop trigger if exists set_project_reviews_updated_at on public.project_reviews;
create trigger set_project_reviews_updated_at
before update on public.project_reviews
for each row execute function public.set_updated_at();

insert into public.app_users (name, username, password_hash, role)
values
  ('Daniel Třetina', 'admin', crypt('admin123', gen_salt('bf')), 'admin'),
  ('Manažerka', 'manager', crypt('manager123', gen_salt('bf')), 'manager')
on conflict (username) do nothing;

create or replace function public.current_app_user(p_token text)
returns public.app_users
language plpgsql
security definer
set search_path = public
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

create or replace function public.assert_admin(p_token text)
returns public.app_users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.app_users%rowtype;
begin
  select * into v_user from public.current_app_user(p_token);
  if v_user.role <> 'admin' then
    raise exception 'Na tuto akci nemáš oprávnění.';
  end if;
  return v_user;
end;
$$;

create or replace function public.assert_manager(p_token text)
returns public.app_users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.app_users%rowtype;
begin
  select * into v_user from public.current_app_user(p_token);
  if v_user.role <> 'manager' then
    raise exception 'Tuto akci může provést pouze manažerka.';
  end if;
  return v_user;
end;
$$;

create or replace function public.login_user(p_username text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public
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
set search_path = public
as $$
begin
  delete from public.app_sessions
  where token_hash = encode(digest(p_token, 'sha256'), 'hex');
  return true;
end;
$$;

create or replace function public.get_app_data(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.app_users%rowtype;
begin
  select * into v_user from public.current_app_user(p_token);

  return jsonb_build_object(
    'currentUser', jsonb_build_object(
      'id', v_user.id,
      'name', v_user.name,
      'username', v_user.username,
      'role', v_user.role
    ),
    'notes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', n.id,
          'date', n.date,
          'title', n.title,
          'content', n.content,
          'priority', n.priority,
          'created_at', n.created_at,
          'updated_at', n.updated_at,
          'documents', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', d.id,
                'note_id', d.note_id,
                'file_name', d.file_name,
                'mime_type', d.mime_type,
                'file_size', d.file_size,
                'created_at', d.created_at
              )
              order by d.created_at desc
            )
            from public.calendar_documents d
            where d.note_id = n.id
          ), '[]'::jsonb)
        )
        order by n.date desc, n.updated_at desc
      )
      from public.calendar_notes n
    ), '[]'::jsonb),
    'projects', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'title', p.title,
          'short_description', p.short_description,
          'full_description', p.full_description,
          'category', p.category,
          'priority', p.priority,
          'status', p.status,
          'created_at', p.created_at,
          'updated_at', p.updated_at,
          'checklist', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', c.id,
                'project_id', c.project_id,
                'text', c.text,
                'is_done', c.is_done,
                'created_at', c.created_at,
                'updated_at', c.updated_at
              )
              order by c.created_at asc
            )
            from public.project_checklist_items c
            where c.project_id = p.id
          ), '[]'::jsonb),
          'reviews', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', r.id,
                'project_id', r.project_id,
                'reviewer_user_id', r.reviewer_user_id,
                'rating', r.rating,
                'comment', r.comment,
                'created_at', r.created_at,
                'updated_at', r.updated_at
              )
              order by r.updated_at desc
            )
            from public.project_reviews r
            where r.project_id = p.id
          ), '[]'::jsonb)
        )
        order by p.updated_at desc
      )
      from public.projects p
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.add_calendar_note(
  p_token text,
  p_date date,
  p_title text,
  p_content text,
  p_priority text default 'normal'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.app_users%rowtype;
  v_id uuid;
begin
  select * into v_user from public.assert_admin(p_token);

  insert into public.calendar_notes (date, title, content, priority)
  values (p_date, nullif(trim(p_title), ''), p_content, coalesce(p_priority, 'normal'))
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.update_calendar_note(
  p_token text,
  p_note_id uuid,
  p_title text,
  p_content text,
  p_priority text default 'normal'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.app_users%rowtype;
begin
  select * into v_user from public.assert_admin(p_token);

  update public.calendar_notes
  set title = nullif(trim(p_title), ''),
      content = p_content,
      priority = coalesce(p_priority, 'normal')
  where id = p_note_id;

  return found;
end;
$$;

create or replace function public.delete_calendar_note(p_token text, p_note_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.app_users%rowtype;
begin
  select * into v_user from public.assert_admin(p_token);
  delete from public.calendar_notes where id = p_note_id;
  return found;
end;
$$;

create or replace function public.add_calendar_document(
  p_token text,
  p_note_id uuid,
  p_file_name text,
  p_mime_type text,
  p_file_size bigint,
  p_content_base64 text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.app_users%rowtype;
  v_id uuid;
begin
  select * into v_user from public.assert_admin(p_token);

  if not exists (select 1 from public.calendar_notes where id = p_note_id) then
    raise exception 'Poznámka nebyla nalezena.';
  end if;

  insert into public.calendar_documents (note_id, file_name, mime_type, file_size, content_base64)
  values (p_note_id, p_file_name, p_mime_type, coalesce(p_file_size, 0), p_content_base64)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.get_calendar_document(p_token text, p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.app_users%rowtype;
  v_doc public.calendar_documents%rowtype;
begin
  select * into v_user from public.current_app_user(p_token);
  select * into v_doc from public.calendar_documents where id = p_document_id;

  if v_doc.id is null then
    raise exception 'Dokument nebyl nalezen.';
  end if;

  return jsonb_build_object(
    'id', v_doc.id,
    'note_id', v_doc.note_id,
    'file_name', v_doc.file_name,
    'mime_type', v_doc.mime_type,
    'file_size', v_doc.file_size,
    'content_base64', v_doc.content_base64,
    'created_at', v_doc.created_at
  );
end;
$$;

create or replace function public.delete_calendar_document(p_token text, p_document_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.app_users%rowtype;
begin
  select * into v_user from public.assert_admin(p_token);
  delete from public.calendar_documents where id = p_document_id;
  return found;
end;
$$;

create or replace function public.create_project(
  p_token text,
  p_title text,
  p_short_description text,
  p_full_description text,
  p_category text default 'idea',
  p_priority text default 'normal',
  p_status text default 'Aktivní'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.app_users%rowtype;
  v_id uuid;
begin
  select * into v_user from public.assert_admin(p_token);

  insert into public.projects (title, short_description, full_description, category, priority, status)
  values (nullif(trim(p_title), ''), p_short_description, p_full_description, p_category, p_priority, p_status)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.update_project(
  p_token text,
  p_project_id uuid,
  p_title text,
  p_short_description text,
  p_full_description text,
  p_category text,
  p_priority text,
  p_status text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.app_users%rowtype;
begin
  select * into v_user from public.assert_admin(p_token);

  update public.projects
  set title = nullif(trim(p_title), ''),
      short_description = p_short_description,
      full_description = p_full_description,
      category = p_category,
      priority = p_priority,
      status = p_status
  where id = p_project_id;

  return found;
end;
$$;

create or replace function public.move_project(p_token text, p_project_id uuid, p_category text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.app_users%rowtype;
begin
  select * into v_user from public.assert_admin(p_token);

  update public.projects
  set category = p_category
  where id = p_project_id;

  return found;
end;
$$;

create or replace function public.delete_project(p_token text, p_project_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.app_users%rowtype;
begin
  select * into v_user from public.assert_admin(p_token);
  delete from public.projects where id = p_project_id;
  return found;
end;
$$;

create or replace function public.add_checklist_item(p_token text, p_project_id uuid, p_text text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.app_users%rowtype;
  v_id uuid;
begin
  select * into v_user from public.assert_admin(p_token);

  insert into public.project_checklist_items (project_id, text)
  values (p_project_id, nullif(trim(p_text), ''))
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.update_checklist_item(p_token text, p_item_id uuid, p_is_done boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.app_users%rowtype;
begin
  select * into v_user from public.assert_admin(p_token);

  update public.project_checklist_items
  set is_done = coalesce(p_is_done, false)
  where id = p_item_id;

  return found;
end;
$$;

create or replace function public.delete_checklist_item(p_token text, p_item_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.app_users%rowtype;
begin
  select * into v_user from public.assert_admin(p_token);
  delete from public.project_checklist_items where id = p_item_id;
  return found;
end;
$$;

create or replace function public.save_project_review(
  p_token text,
  p_project_id uuid,
  p_rating integer,
  p_comment text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.app_users%rowtype;
  v_id uuid;
begin
  select * into v_user from public.assert_manager(p_token);

  if p_rating < 1 or p_rating > 5 then
    raise exception 'Hodnocení musí být od 1 do 5.';
  end if;

  insert into public.project_reviews (project_id, reviewer_user_id, rating, comment)
  values (p_project_id, v_user.id, p_rating, p_comment)
  on conflict (project_id, reviewer_user_id)
  do update set rating = excluded.rating,
                comment = excluded.comment,
                updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

do $$
declare
  v_p1 uuid;
  v_p2 uuid;
  v_p3 uuid;
begin
  if not exists (select 1 from public.calendar_notes) then
    insert into public.calendar_notes (date, title, content, priority)
    values
      (current_date, 'Dnešní pracovní přehled', 'Zkontrolovat rozpracované projekty a připravit další kroky.', 'normal'),
      (current_date + 1, 'Podklady pro manažerku', 'Doplnit poznámky k projektům, které půjdou na kontrolu.', 'high'),
      (current_date + 3, 'Týdenní shrnutí', 'Stáhnout export poznámek a zkontrolovat dokončené úkoly.', 'normal');
  end if;

  if not exists (select 1 from public.projects) then
    insert into public.projects (title, short_description, full_description, category, priority, status)
    values
      ('Nový nápad na interní nástroj', 'Rychlý koncept pro evidenci práce a poznámek.', 'Cílem je vytvořit jednoduchý přehled práce, kde budou poznámky, dokumenty, projekty a komentáře manažerky.', 'idea', 'normal', 'Nápad')
    returning id into v_p1;

    insert into public.projects (title, short_description, full_description, category, priority, status)
    values
      ('Přehled práce pro tým', 'Rozpracovaný pracovní panel s kalendářem a projektovou částí.', 'Projekt řeší každodenní evidenci práce, přehled projektů, checklist a zpětnou vazbu manažerky.', 'in_progress', 'high', 'Rozpracováno')
    returning id into v_p2;

    insert into public.projects (title, short_description, full_description, category, priority, status)
    values
      ('Ukázkový hotový projekt', 'Vzor dokončeného projektu pro testování aplikace.', 'Tento projekt slouží jako ukázka hotového výstupu v aplikaci.', 'done', 'low', 'Hotovo')
    returning id into v_p3;

    insert into public.project_checklist_items (project_id, text, is_done)
    values
      (v_p2, 'Připravit databázové tabulky', true),
      (v_p2, 'Napojit aplikaci na Supabase', true),
      (v_p2, 'Otestovat role admin a manažerka', false);
  end if;
end $$;

grant usage on schema public to anon, authenticated;
grant execute on all functions in schema public to anon, authenticated;
