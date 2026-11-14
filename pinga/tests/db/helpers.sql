-- Test helpers: act as a given person, and simple pass/fail checks.

create schema tests;
grant usage on schema tests to anon, authenticated, service_role;

-- Act as a signed-in user (or anonymous visitor when p_user is null).
create function tests.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p_user is null then '{}' else json_build_object('sub', p_user)::text end, true);
  execute format('set local role %I', case when p_user is null then 'anon' else 'authenticated' end);
end $$;

create function tests.act_as_server() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{}', true);
  set local role service_role;
end $$;

create function tests.ok(p_pass boolean, p_name text) returns void language plpgsql as $$
begin
  if p_pass is distinct from true then
    raise exception 'FAIL: %', p_name;
  end if;
  raise notice 'ok - %', p_name;
end $$;

create function tests.eq(p_got anyelement, p_want anyelement, p_name text) returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then
    raise exception 'FAIL: % (got %, want %)', p_name, p_got, p_want;
  end if;
  raise notice 'ok - %', p_name;
end $$;

-- Passes when the statement is refused (raises any error).
create function tests.refused(p_sql text, p_name text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice 'ok - % (refused: %)', p_name, sqlerrm;
    return;
  end;
  raise exception 'FAIL: % (was allowed)', p_name;
end $$;

-- Passes when an update/delete runs but touches zero rows (hidden by row rules).
create function tests.no_rows(p_sql text, p_name text) returns void language plpgsql as $$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: % (changed % rows)', p_name, n; end if;
  raise notice 'ok - %', p_name;
end $$;

grant execute on all functions in schema tests to anon, authenticated, service_role;
