-- Local-development exception: allow sign-in for specific EXACT email addresses in addition to the
-- allowed domains. The addresses are passed in by the app from its environment (DEV_ALLOWED_EMAIL);
-- nothing about any address is stored or written here. The app refuses to supply any in production.
--
-- Everything else is unchanged from 002: the same one-time code, attempt limit, throttle (in
-- auth_request_login_code), plus-alias rejection, and member-by-default role (admin only comes from
-- the admin_emails allowlist via the profiles trigger).

drop function auth_verify_and_login(text, text, text[], text, integer);

create function auth_verify_and_login(
  p_email text, p_code_hash text, p_allowed_domains text[], p_session_hash text, p_session_ttl_seconds integer,
  p_allowed_emails text[] default '{}')
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_email  text := lower(btrim(p_email));
  v_local  text := split_part(lower(btrim(p_email)), '@', 1);
  v_domain text := split_part(lower(btrim(p_email)), '@', 2);
  v_code   login_codes;
  v_user   profiles;
begin
  -- Plus aliases and malformed addresses are never allowed, even for an exact-address exception.
  -- Otherwise the address must be on an allowed domain OR equal (whole address) to an allowed email.
  if v_local = '' or v_local like '%+%' or v_email like '%@%@%'
     or not (v_domain = any (array(select lower(btrim(d)) from unnest(p_allowed_domains) d))
             or v_email = any (array(select lower(btrim(e)) from unnest(coalesce(p_allowed_emails, '{}')) e))) then
    return null;
  end if;

  select * into v_code from login_codes
  where email = v_email and consumed_at is null and expires_at > now()
  order by created_at desc, id desc limit 1
  for update;
  if not found or v_code.attempts >= 5 then
    return null;
  end if;

  if v_code.code_hash <> p_code_hash then
    update login_codes set attempts = attempts + 1 where id = v_code.id;
    return null;
  end if;
  update login_codes set consumed_at = now() where id = v_code.id;

  select * into v_user from profiles where email = v_email;
  if not found then
    insert into profiles (email, display_name)
    values (v_email, left(initcap(regexp_replace(v_local, '[._-]+', ' ', 'g')), 100))
    returning * into v_user;
  end if;
  if v_user.disabled then
    return null;
  end if;

  insert into sessions (token_hash, user_id, expires_at)
  values (p_session_hash, v_user.id, now() + make_interval(secs => p_session_ttl_seconds));
  return v_user.id;
end $$;

revoke execute on function auth_verify_and_login(text, text, text[], text, integer, text[]) from public;
grant execute on function auth_verify_and_login(text, text, text[], text, integer, text[]) to tracker_app;
