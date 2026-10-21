-- Password sign-in. Sign-up and password reset both prove control of the email with the existing
-- one-time code, and set a password in the same step. After that the user signs in with email +
-- password and only needs a code again to reset a forgotten password.
--
-- The app hashes passwords (scrypt) and passes only the salt and hash; the database never sees a
-- plain password. Credentials live in their own table that the runtime role cannot read or write:
-- everything goes through the definer functions below. Wrong-password attempts lock an account for
-- 15 minutes after 5 in a row. Role assignment is unchanged (admin only via admin_emails).

create table credentials (
  user_id         uuid primary key references profiles (id) on delete cascade,
  salt            text not null,
  hash            text not null,
  failed_attempts integer not null default 0,
  locked_until    timestamptz,
  updated_at      timestamptz not null default now()
);
alter table credentials enable row level security;
-- No policies and no grants for tracker_app: only the functions below (owner) can touch it.

-- The code-only login function is replaced by one that also sets the password.
drop function auth_verify_and_login(text, text, text[], text, integer, text[]);

create function auth_set_password(
  p_email text, p_code_hash text, p_allowed_domains text[], p_session_hash text, p_session_ttl_seconds integer,
  p_allowed_emails text[], p_salt text, p_hash text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_email  text := lower(btrim(p_email));
  v_local  text := split_part(lower(btrim(p_email)), '@', 1);
  v_domain text := split_part(lower(btrim(p_email)), '@', 2);
  v_code   login_codes;
  v_user   profiles;
begin
  if coalesce(p_salt, '') = '' or coalesce(p_hash, '') = '' then
    return null;
  end if;
  -- Plus aliases and malformed addresses are never allowed. Otherwise the address must be on an
  -- allowed domain OR equal (whole address) to an allowed email.
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

  insert into credentials (user_id, salt, hash) values (v_user.id, p_salt, p_hash)
  on conflict (user_id) do update
    set salt = excluded.salt, hash = excluded.hash, failed_attempts = 0, locked_until = null, updated_at = now();

  insert into sessions (token_hash, user_id, expires_at)
  values (p_session_hash, v_user.id, now() + make_interval(secs => p_session_ttl_seconds));
  return v_user.id;
end $$;

-- The salt for an address, so the app can hash what was typed. Null when there is no password yet
-- (the app then uses a fake salt, so the response looks the same either way).
create function auth_password_salt(p_email text)
returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select c.salt from credentials c join profiles p on p.id = c.user_id where p.email = lower(btrim(p_email));
$$;

-- Starts a session when the hash matches. Returns the user id, or null on any failure (unknown
-- address, no password, wrong password, locked, disabled, or address not allowed).
create function auth_password_login(
  p_email text, p_hash text, p_allowed_domains text[], p_session_hash text, p_session_ttl_seconds integer,
  p_allowed_emails text[])
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_email  text := lower(btrim(p_email));
  v_local  text := split_part(lower(btrim(p_email)), '@', 1);
  v_domain text := split_part(lower(btrim(p_email)), '@', 2);
  v_user   profiles;
  v_cred   credentials;
begin
  if v_local = '' or v_local like '%+%' or v_email like '%@%@%'
     or not (v_domain = any (array(select lower(btrim(d)) from unnest(p_allowed_domains) d))
             or v_email = any (array(select lower(btrim(e)) from unnest(coalesce(p_allowed_emails, '{}')) e))) then
    return null;
  end if;

  select * into v_user from profiles where email = v_email;
  if not found or v_user.disabled then
    return null;
  end if;
  select * into v_cred from credentials where user_id = v_user.id for update;
  if not found or (v_cred.locked_until is not null and v_cred.locked_until > now()) then
    return null;
  end if;

  if v_cred.hash <> p_hash then
    update credentials
       set failed_attempts = case when failed_attempts + 1 >= 5 then 0 else failed_attempts + 1 end,
           locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' else locked_until end
     where user_id = v_user.id;
    return null;
  end if;

  update credentials set failed_attempts = 0, locked_until = null where user_id = v_user.id;
  insert into sessions (token_hash, user_id, expires_at)
  values (p_session_hash, v_user.id, now() + make_interval(secs => p_session_ttl_seconds));
  return v_user.id;
end $$;

revoke execute on function auth_set_password(text, text, text[], text, integer, text[], text, text) from public;
revoke execute on function auth_password_salt(text) from public;
revoke execute on function auth_password_login(text, text, text[], text, integer, text[]) from public;
grant execute on function auth_set_password(text, text, text[], text, integer, text[], text, text) to tracker_app;
grant execute on function auth_password_salt(text) to tracker_app;
grant execute on function auth_password_login(text, text, text[], text, integer, text[]) to tracker_app;
