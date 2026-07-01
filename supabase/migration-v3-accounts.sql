-- Migrace v3: první admin registrace, účty manažerek a oddělení dat podle admin účtu.
-- Spusť v Supabase SQL Editoru přes Run.

create extension if not exists pgcrypto;

alter table public.app_users
  add column if not exists owner_admin_id uuid references public.app_users(id) on delete cascade;

alter table public.calendar_notes
  add column if not exists owner_user_id uuid references public.app_users(id) on delete cascade;

alter table public.projects
  add column if not exists owner_user_id uuid references public.app_users(id) on delete cascade;

-- Odstranění původních testovacích účtů a jejich relací/hodnocení.
delete from public.app_sessions;
delete from public.project_reviews
where reviewer_user_id in (
  select id from public.app_users where lower(username) in ('admin', 'manager')
);
delete from public.app_users
where lower(username) in ('admin', 'manager');

-- Pokud v databázi zůstal jiný admin, nastav ho jako vlastníka svého prostoru.
update public.app_users
set owner_admin_id = id
where role = 'admin' and owner_admin_id is null;

-- Pomocná funkce: existuje už admin?
create or replace function public.app_has_admin()
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
  select exists (select 1 from public.app_users where role = 'admin');
$$;

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

  if v_user.role = 'admin' and v_user.owner_admin_id is null then
    update public.app_users set owner_admin_id = v_user.id where id = v_user.id;
    v_user.owner_admin_id := v_user.id;
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
      'role', v_user.role,
      'owner_admin_id', v_user.owner_admin_id
    )
  );
end;
$$;

create or replace function public.register_first_admin(p_name text, p_username text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user public.app_users%rowtype;
  v_token text;
begin
  if exists (select 1 from public.app_users where role = 'admin') then
    raise exception 'Admin účet už existuje. Přihlas se a další účty vytvoř v nastavení.';
  end if;

  if length(coalesce(trim(p_username), '')) < 3 then
    raise exception 'Uživatelské jméno musí mít alespoň 3 znaky.';
  end if;

  if length(coalesce(p_password, '')) < 6 then
    raise exception 'Heslo musí mít alespoň 6 znaků.';
  end if;

  insert into public.app_users (name, username, password_hash, role)
  values (nullif(trim(p_name), ''), lower(trim(p_username)), crypt(p_password, gen_salt('bf')), 'admin')
  returning * into v_user;

  update public.app_users set owner_admin_id = v_user.id where id = v_user.id;
  v_user.owner_admin_id := v_user.id;

  -- Případná starší neoznačená data přiřaď prvnímu adminovi.
  update public.calendar_notes set owner_user_id = v_user.id where owner_user_id is null;
  update public.projects set owner_user_id = v_user.id where owner_user_id is null;

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
      'role', v_user.role,
      'owner_admin_id', v_user.owner_admin_id
    )
  );
end;
$$;

create or replace function public.assert_admin(p_token text)
returns public.app_users
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user public.app_users%rowtype;
begin
  select * into v_user from public.current_app_user(p_token);
  if v_user.role <> 'admin' then
    raise exception 'Na tuto akci nemáš oprávnění.';
  end if;
  if v_user.owner_admin_id is null then
    update public.app_users set owner_admin_id = v_user.id where id = v_user.id;
    v_user.owner_admin_id := v_user.id;
  end if;
  return v_user;
end;
$$;

create or replace function public.assert_manager(p_token text)
returns public.app_users
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user public.app_users%rowtype;
begin
  select * into v_user from public.current_app_user(p_token);
  if v_user.role <> 'manager' then
    raise exception 'Tuto akci může provést pouze manažerka.';
  end if;
  if v_user.owner_admin_id is null then
    raise exception 'Tento manažerský účet není přiřazený k adminovi.';
  end if;
  return v_user;
end;
$$;

create or replace function public.create_manager_account(
  p_token text,
  p_name text,
  p_username text,
  p_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_admin public.app_users%rowtype;
  v_new public.app_users%rowtype;
begin
  select * into v_admin from public.assert_admin(p_token);

  if length(coalesce(trim(p_username), '')) < 3 then
    raise exception 'Uživatelské jméno musí mít alespoň 3 znaky.';
  end if;

  if length(coalesce(p_password, '')) < 6 then
    raise exception 'Heslo musí mít alespoň 6 znaků.';
  end if;

  insert into public.app_users (name, username, password_hash, role, owner_admin_id)
  values (nullif(trim(p_name), ''), lower(trim(p_username)), crypt(p_password, gen_salt('bf')), 'manager', v_admin.id)
  returning * into v_new;

  return jsonb_build_object(
    'id', v_new.id,
    'name', v_new.name,
    'username', v_new.username,
    'role', v_new.role,
    'owner_admin_id', v_new.owner_admin_id
  );
exception
  when unique_violation then
    raise exception 'Toto uživatelské jméno už existuje.';
end;
$$;

create or replace function public.get_app_data(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user public.app_users%rowtype;
  v_owner uuid;
begin
  select * into v_user from public.current_app_user(p_token);
  v_owner := case when v_user.role = 'admin' then v_user.id else v_user.owner_admin_id end;

  return jsonb_build_object(
    'currentUser', jsonb_build_object(
      'id', v_user.id,
      'name', v_user.name,
      'username', v_user.username,
      'role', v_user.role,
      'owner_admin_id', v_user.owner_admin_id
    ),
    'managerAccounts', case when v_user.role = 'admin' then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', u.id,
        'name', u.name,
        'username', u.username,
        'role', u.role,
        'created_at', u.created_at
      ) order by u.created_at desc)
      from public.app_users u
      where u.role = 'manager' and u.owner_admin_id = v_user.id
    ), '[]'::jsonb) else '[]'::jsonb end,
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
      where n.owner_user_id = v_owner
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
              and (v_user.role = 'admin' or r.reviewer_user_id = v_user.id)
          ), '[]'::jsonb)
        )
        order by p.updated_at desc
      )
      from public.projects p
      where p.owner_user_id = v_owner
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
set search_path = public, extensions
as $$
declare
  v_user public.app_users%rowtype;
  v_id uuid;
begin
  select * into v_user from public.assert_admin(p_token);

  insert into public.calendar_notes (owner_user_id, date, title, content, priority)
  values (v_user.id, p_date, nullif(trim(p_title), ''), p_content, coalesce(p_priority, 'normal'))
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
set search_path = public, extensions
as $$
declare
  v_user public.app_users%rowtype;
begin
  select * into v_user from public.assert_admin(p_token);

  update public.calendar_notes
  set title = nullif(trim(p_title), ''),
      content = p_content,
      priority = coalesce(p_priority, 'normal')
  where id = p_note_id and owner_user_id = v_user.id;

  return found;
end;
$$;

create or replace function public.delete_calendar_note(p_token text, p_note_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user public.app_users%rowtype;
begin
  select * into v_user from public.assert_admin(p_token);
  delete from public.calendar_notes where id = p_note_id and owner_user_id = v_user.id;
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
set search_path = public, extensions
as $$
declare
  v_user public.app_users%rowtype;
  v_id uuid;
begin
  select * into v_user from public.assert_admin(p_token);

  if not exists (select 1 from public.calendar_notes where id = p_note_id and owner_user_id = v_user.id) then
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
set search_path = public, extensions
as $$
declare
  v_user public.app_users%rowtype;
  v_owner uuid;
  v_doc public.calendar_documents%rowtype;
begin
  select * into v_user from public.current_app_user(p_token);
  v_owner := case when v_user.role = 'admin' then v_user.id else v_user.owner_admin_id end;

  select d.* into v_doc
  from public.calendar_documents d
  join public.calendar_notes n on n.id = d.note_id
  where d.id = p_document_id and n.owner_user_id = v_owner;

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
set search_path = public, extensions
as $$
declare
  v_user public.app_users%rowtype;
begin
  select * into v_user from public.assert_admin(p_token);
  delete from public.calendar_documents d
  using public.calendar_notes n
  where d.id = p_document_id and d.note_id = n.id and n.owner_user_id = v_user.id;
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
set search_path = public, extensions
as $$
declare
  v_user public.app_users%rowtype;
  v_id uuid;
begin
  select * into v_user from public.assert_admin(p_token);

  insert into public.projects (owner_user_id, title, short_description, full_description, category, priority, status)
  values (v_user.id, nullif(trim(p_title), ''), p_short_description, p_full_description, p_category, p_priority, p_status)
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
set search_path = public, extensions
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
  where id = p_project_id and owner_user_id = v_user.id;

  return found;
end;
$$;

create or replace function public.move_project(p_token text, p_project_id uuid, p_category text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user public.app_users%rowtype;
begin
  select * into v_user from public.assert_admin(p_token);

  update public.projects
  set category = p_category
  where id = p_project_id and owner_user_id = v_user.id;

  return found;
end;
$$;

create or replace function public.delete_project(p_token text, p_project_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user public.app_users%rowtype;
begin
  select * into v_user from public.assert_admin(p_token);
  delete from public.projects where id = p_project_id and owner_user_id = v_user.id;
  return found;
end;
$$;

create or replace function public.add_checklist_item(p_token text, p_project_id uuid, p_text text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user public.app_users%rowtype;
  v_id uuid;
begin
  select * into v_user from public.assert_admin(p_token);

  if not exists (select 1 from public.projects where id = p_project_id and owner_user_id = v_user.id) then
    raise exception 'Projekt nebyl nalezen.';
  end if;

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
set search_path = public, extensions
as $$
declare
  v_user public.app_users%rowtype;
begin
  select * into v_user from public.assert_admin(p_token);

  update public.project_checklist_items c
  set is_done = coalesce(p_is_done, false)
  from public.projects p
  where c.id = p_item_id and c.project_id = p.id and p.owner_user_id = v_user.id;

  return found;
end;
$$;

create or replace function public.delete_checklist_item(p_token text, p_item_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user public.app_users%rowtype;
begin
  select * into v_user from public.assert_admin(p_token);
  delete from public.project_checklist_items c
  using public.projects p
  where c.id = p_item_id and c.project_id = p.id and p.owner_user_id = v_user.id;
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
set search_path = public, extensions
as $$
declare
  v_user public.app_users%rowtype;
  v_id uuid;
begin
  select * into v_user from public.assert_manager(p_token);

  if p_rating < 1 or p_rating > 5 then
    raise exception 'Hodnocení musí být od 1 do 5.';
  end if;

  if not exists (select 1 from public.projects where id = p_project_id and owner_user_id = v_user.owner_admin_id) then
    raise exception 'Projekt nebyl nalezen.';
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

grant usage on schema public to anon, authenticated;
grant execute on all functions in schema public to anon, authenticated;
