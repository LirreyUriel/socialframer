-- Run this in the Supabase SQL editor (bawcojqjzbnlblhpvzja).
-- Adds identity columns to the existing posts table and server-side
-- usage checks for the 24-hour freemium limits.

alter table public.posts
  add column if not exists user_id uuid references auth.users (id) on delete set null,
  add column if not exists guest_id text,
  add column if not exists watermarked boolean not null default false;

alter table public.posts
  alter column id set default gen_random_uuid();

create index if not exists posts_user_created_at_idx
  on public.posts (user_id, created_at desc);

create index if not exists posts_guest_created_at_idx
  on public.posts (guest_id, created_at desc);

alter table public.profiles
  add column if not exists is_premium boolean not null default false;

create or replace function public.handle_new_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, is_premium)
  values (new.id, new.email, false)
  on conflict (id) do update
    set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_profile on auth.users;
create trigger on_auth_user_profile
  after insert on auth.users
  for each row execute procedure public.handle_new_profile();

create or replace function public.get_usage(p_guest_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_count int := 0;
  v_is_premium boolean := false;
  v_since timestamptz := now() - interval '24 hours';
  v_action text := 'allow';
begin
  if v_user_id is not null then
    begin
      insert into public.profiles (id, email, is_premium)
      values (v_user_id, auth.jwt() ->> 'email', false)
      on conflict (id) do update
        set email = excluded.email;
    exception
      when others then
        null;
    end;

    if p_guest_id is not null and length(trim(p_guest_id)) > 0 then
      update public.posts
      set user_id = v_user_id
      where guest_id = p_guest_id
        and user_id is null;
    end if;

    select coalesce(is_premium, false) into v_is_premium
    from public.profiles
    where id = v_user_id;

    select count(*) into v_count
    from public.posts
    where user_id = v_user_id
      and created_at >= v_since;
  else
    if p_guest_id is null or length(trim(p_guest_id)) = 0 then
      return jsonb_build_object(
        'action', 'allow',
        'allowed', true,
        'count', 0,
        'is_premium', false
      );
    end if;

    select count(*) into v_count
    from public.posts
    where guest_id = p_guest_id
      and created_at >= v_since;
  end if;

  if v_user_id is null and v_count >= 1 then
    v_action := 'require_login';
  elsif v_count >= 2 and not v_is_premium then
    v_action := 'watermark';
  end if;

  return jsonb_build_object(
    'action', v_action,
    'allowed', v_action <> 'require_login',
    'count', v_count,
    'is_premium', v_is_premium
  );
end;
$$;

create or replace function public.create_post(
  p_guest_id text,
  p_platform text,
  p_content text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usage jsonb;
  v_action text;
  v_id uuid;
  v_user_id uuid := auth.uid();
begin
  v_usage := public.get_usage(p_guest_id);
  v_action := v_usage ->> 'action';

  if v_action = 'require_login' then
    return v_usage;
  end if;

  insert into public.posts (
    id,
    user_id,
    guest_id,
    platform,
    content,
    watermarked,
    created_at
  ) values (
    gen_random_uuid(),
    v_user_id,
    nullif(trim(coalesce(p_guest_id, '')), ''),
    left(coalesce(p_platform, 'linkedin'), 32),
    left(coalesce(p_content, ''), 2000),
    v_action = 'watermark',
    now()
  )
  returning id into v_id;

  return jsonb_build_object(
    'action', v_action,
    'allowed', true,
    'count', coalesce((v_usage ->> 'count')::int, 0) + 1,
    'is_premium', coalesce((v_usage ->> 'is_premium')::boolean, false),
    'watermarked', v_action = 'watermark',
    'post_id', v_id
  );
end;
$$;

alter table public.profiles
  add column if not exists paddle_customer_id text,
  add column if not exists brand_kit jsonb;

create or replace function public.save_brand_kit(p_kit jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_is_premium boolean := false;
  v_kit jsonb;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'signin_required');
  end if;

  select coalesce(is_premium, false) into v_is_premium
  from public.profiles
  where id = v_user_id;

  if not v_is_premium then
    return jsonb_build_object('ok', false, 'error', 'premium_required');
  end if;

  v_kit := jsonb_build_object(
    'name', left(coalesce(p_kit ->> 'name', ''), 120),
    'headline', left(coalesce(p_kit ->> 'headline', ''), 180),
    'handle', left(coalesce(p_kit ->> 'handle', ''), 60),
    'verified', coalesce((p_kit ->> 'verified')::boolean, false)
  );

  update public.profiles
  set brand_kit = v_kit
  where id = v_user_id;

  return jsonb_build_object('ok', true, 'kit', v_kit);
end;
$$;

create or replace function public.get_brand_kit()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_kit jsonb;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'kit', null);
  end if;

  select brand_kit into v_kit
  from public.profiles
  where id = v_user_id;

  return jsonb_build_object('ok', true, 'kit', v_kit);
end;
$$;

alter table public.posts
  add column if not exists scheduled_date date,
  add column if not exists name text;

update public.posts
set scheduled_date = created_at::date
where scheduled_date is null;

create index if not exists posts_user_scheduled_idx
  on public.posts (user_id, scheduled_date desc);

drop function if exists public.create_post(text, text, text);
drop function if exists public.create_post(text, text, text, date);

create or replace function public.create_post(
  p_guest_id text,
  p_platform text,
  p_content text default '',
  p_scheduled_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usage jsonb;
  v_action text;
  v_id uuid;
  v_user_id uuid := auth.uid();
  v_date date := coalesce(p_scheduled_date, current_date);
begin
  v_usage := public.get_usage(p_guest_id);
  v_action := v_usage ->> 'action';

  if v_action = 'require_login' then
    return v_usage;
  end if;

  insert into public.posts (
    id,
    user_id,
    guest_id,
    platform,
    content,
    watermarked,
    scheduled_date,
    created_at
  ) values (
    gen_random_uuid(),
    v_user_id,
    nullif(trim(coalesce(p_guest_id, '')), ''),
    left(coalesce(p_platform, 'linkedin'), 32),
    left(coalesce(p_content, ''), 2000),
    v_action = 'watermark',
    v_date,
    now()
  )
  returning id into v_id;

  return jsonb_build_object(
    'action', v_action,
    'allowed', true,
    'count', coalesce((v_usage ->> 'count')::int, 0) + 1,
    'is_premium', coalesce((v_usage ->> 'is_premium')::boolean, false),
    'watermarked', v_action = 'watermark',
    'post_id', v_id,
    'scheduled_date', v_date
  );
end;
$$;

create or replace function public.list_my_posts()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'signin_required', 'posts', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'ok', true,
    'posts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'platform', p.platform,
        'content', p.content,
        'scheduled_date', p.scheduled_date,
        'created_at', p.created_at,
        'watermarked', p.watermarked
      ) order by coalesce(p.scheduled_date, p.created_at::date) desc, p.created_at desc)
      from public.posts p
      where p.user_id = v_user_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.update_post(
  p_id uuid,
  p_platform text,
  p_content text,
  p_scheduled_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.posts;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'signin_required');
  end if;

  update public.posts
  set
    platform = left(coalesce(p_platform, platform), 32),
    content = left(coalesce(p_content, content), 2000),
    scheduled_date = coalesce(p_scheduled_date, scheduled_date)
  where id = p_id
    and user_id = v_user_id
  returning * into v_row;

  if v_row.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'post', jsonb_build_object(
      'id', v_row.id,
      'platform', v_row.platform,
      'content', v_row.content,
      'scheduled_date', v_row.scheduled_date
    )
  );
end;
$$;

create or replace function public.save_brand_kit(p_kit jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_kit jsonb;
  v_colors jsonb;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'signin_required');
  end if;

  insert into public.profiles (id, email, is_premium)
  values (v_user_id, auth.jwt() ->> 'email', false)
  on conflict (id) do nothing;

  v_colors := jsonb_build_object(
    'primary', left(coalesce(p_kit #>> '{colors,primary}', p_kit ->> 'primary', '#2563eb'), 16),
    'secondary', left(coalesce(p_kit #>> '{colors,secondary}', p_kit ->> 'secondary', '#0ea5e9'), 16),
    'accent', left(coalesce(p_kit #>> '{colors,accent}', p_kit ->> 'accent', '#ec4899'), 16)
  );

  v_kit := jsonb_build_object(
    'name', left(coalesce(p_kit ->> 'name', ''), 120),
    'headline', left(coalesce(p_kit ->> 'headline', ''), 180),
    'handle', left(coalesce(p_kit ->> 'handle', ''), 60),
    'verified', coalesce((p_kit ->> 'verified')::boolean, false),
    'avatar_url', left(coalesce(p_kit ->> 'avatar_url', ''), 2000),
    'colors', v_colors
  );

  update public.profiles
  set brand_kit = v_kit
  where id = v_user_id;

  return jsonb_build_object('ok', true, 'kit', v_kit);
end;
$$;

do $$
begin
  insert into storage.buckets (id, name, public)
  values ('avatars', 'avatars', true)
  on conflict (id) do nothing;

  drop policy if exists avatars_read_public on storage.objects;
  create policy avatars_read_public
    on storage.objects for select
    to public
    using (bucket_id = 'avatars');

  drop policy if exists avatars_insert_own on storage.objects;
  create policy avatars_insert_own
    on storage.objects for insert
    to authenticated
    with check (
      bucket_id = 'avatars'
      and (storage.foldername(name))[1] = auth.uid()::text
    );

  drop policy if exists avatars_update_own on storage.objects;
  create policy avatars_update_own
    on storage.objects for update
    to authenticated
    using (
      bucket_id = 'avatars'
      and (storage.foldername(name))[1] = auth.uid()::text
    );
exception
  when others then
    null;
end $$;

revoke all on function public.get_usage(text) from public;
revoke all on function public.create_post(text, text, text, date) from public;
revoke all on function public.list_my_posts() from public;
revoke all on function public.update_post(uuid, text, text, date) from public;
revoke all on function public.save_brand_kit(jsonb) from public;
revoke all on function public.get_brand_kit() from public;
grant execute on function public.get_usage(text) to anon, authenticated;
grant execute on function public.create_post(text, text, text, date) to anon, authenticated;
grant execute on function public.list_my_posts() to authenticated;
grant execute on function public.update_post(uuid, text, text, date) to authenticated;
grant execute on function public.save_brand_kit(jsonb) to authenticated;
grant execute on function public.get_brand_kit() to authenticated;
