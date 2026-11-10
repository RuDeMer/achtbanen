-- Test van de beveiliging: kan iemand echt niet bij de gegevens van een ander?
--
-- Draai dit in Supabase (SQL Editor, New query, plakken, Run) nadat je
-- schema.sql hebt gedraaid. Je krijgt een tabel met elke test en de uitslag.
-- Onderaan staat hoeveel tests goed gingen.
--
-- De test maakt twee nepaccounts (Test Anna en Test Bert) en een derde zonder
-- profiel, doet als elk van hen allerlei dingen die wel en niet mogen, en draait
-- daarna alles terug. Er blijft niets achter in je database.

create or replace function pg_temp.probeer(wie uuid, opdracht text) returns text
language plpgsql as $$
declare
  n bigint;
begin
  -- Doe alsof dit verzoek van de site komt: zonder account (anon) of ingelogd als "wie"
  if wie is null then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform set_config('role', 'anon', true);
  else
    perform set_config('request.jwt.claims', json_build_object('sub', wie, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
  end if;
  execute opdracht;
  get diagnostics n = row_count;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return 'gelukt: ' || n || ' regels';
exception when others then
  return 'geweigerd: ' || sqlerrm;
end $$;

create or replace function pg_temp.test_beveiliging()
returns table (nr int, test text, verwacht text, uitslag text)
language plpgsql as $$
declare
  anna constant uuid := 'a0a0a0a0-0000-4000-8000-00000000000a';
  bert constant uuid := 'b0b0b0b0-0000-4000-8000-00000000000b';
  cas  constant uuid := 'c0c0c0c0-0000-4000-8000-00000000000c';
  rit_anna bigint;
  rit_bert bigint;
  n bigint;
  t text[] := '{}';  -- wat er getest wordt
  v text[] := '{}';  -- wat er moet gebeuren
  k text[] := '{}';  -- wat er gebeurde
begin
  begin
    insert into auth.users (id, aud, role, email) values
      (anna, 'authenticated', 'authenticated', 'test-anna@voorbeeld.invalid'),
      (bert, 'authenticated', 'authenticated', 'test-bert@voorbeeld.invalid'),
      (cas,  'authenticated', 'authenticated', 'test-cas@voorbeeld.invalid');

    -- Profielen
    t := t || 'Anna maakt haar eigen profiel'::text; v := v || 'gelukt: 1'::text;
    k := k || pg_temp.probeer(anna, format('insert into public.profielen (id, gebruikersnaam, weergavenaam) values (%L, %L, %L)', anna, 'test-anna', 'Test Anna'));
    t := t || 'Anna maakt een profiel voor Bert'::text; v := v || 'geweigerd'::text;
    k := k || pg_temp.probeer(anna, format('insert into public.profielen (id, gebruikersnaam, weergavenaam) values (%L, %L, %L)', bert, 'test-bert-nep', 'Nep Bert'));
    t := t || 'Bert maakt zijn eigen profiel'::text; v := v || 'gelukt: 1'::text;
    k := k || pg_temp.probeer(bert, format('insert into public.profielen (id, gebruikersnaam, weergavenaam, in_ranglijst) values (%L, %L, %L, false)', bert, 'test-bert', 'Test Bert'));
    t := t || 'Anna neemt de gebruikersnaam van Bert'::text; v := v || 'geweigerd'::text;
    k := k || pg_temp.probeer(anna, format('update public.profielen set gebruikersnaam = %L where id = %L', 'test-bert', anna));
    t := t || 'Anna maakt een tweede profiel'::text; v := v || 'geweigerd'::text;
    k := k || pg_temp.probeer(anna, format('insert into public.profielen (id, gebruikersnaam, weergavenaam) values (%L, %L, %L)', anna, 'test-anna-2', 'Test Anna'));
    t := t || 'Iemand zonder account maakt een profiel'::text; v := v || 'geweigerd'::text;
    k := k || pg_temp.probeer(null, format('insert into public.profielen (id, gebruikersnaam, weergavenaam) values (%L, %L, %L)', cas, 'test-cas', 'Test Cas'));

    -- Ritten toevoegen
    t := t || 'Anna zet een rit op haar eigen lijst'::text; v := v || 'gelukt: 1'::text;
    k := k || pg_temp.probeer(anna, 'insert into public.ritten (achtbaan, datum, cijfer, notitie) values (''Q1130871-1'', ''2006-07-14'', 8.5, ''Voorste rij'')');
    t := t || 'Anna zet een rit op de lijst van Bert'::text; v := v || 'geweigerd'::text;
    k := k || pg_temp.probeer(anna, format('insert into public.ritten (gebruiker, achtbaan) values (%L, %L)', bert, 'Q888394'));
    t := t || 'Bert zet een rit op zijn eigen lijst'::text; v := v || 'gelukt: 1'::text;
    k := k || pg_temp.probeer(bert, 'insert into public.ritten (achtbaan, datum) values (''Q888394'', ''2019'')');
    t := t || 'Cas (account zonder profiel) zet een rit op zijn lijst'::text; v := v || 'geweigerd'::text;
    k := k || pg_temp.probeer(cas, 'insert into public.ritten (achtbaan) values (''Q888394'')');
    t := t || 'Iemand zonder account zet een rit op een lijst'::text; v := v || 'geweigerd'::text;
    k := k || pg_temp.probeer(null, format('insert into public.ritten (gebruiker, achtbaan) values (%L, %L)', anna, 'Q888394'));

    select id into rit_anna from public.ritten where gebruiker = anna limit 1;
    select id into rit_bert from public.ritten where gebruiker = bert limit 1;

    -- Lezen
    t := t || 'Iemand zonder account leest de profielen'::text; v := v || 'gelukt'::text;
    k := k || pg_temp.probeer(null, format('select 1 from public.profielen where id in (%L, %L)', anna, bert));
    t := t || 'Iemand zonder account leest de ritten'::text; v := v || 'gelukt'::text;
    k := k || pg_temp.probeer(null, format('select 1 from public.ritten where id in (%s, %s)', rit_anna, rit_bert));
    t := t || 'Anna leest e-mailadressen van andere accounts'::text; v := v || 'geweigerd'::text;
    k := k || pg_temp.probeer(anna, 'select email from auth.users');
    t := t || 'Iemand zonder account leest e-mailadressen'::text; v := v || 'geweigerd'::text;
    k := k || pg_temp.probeer(null, 'select email from auth.users');

    -- Wijzigen en verwijderen bij een ander: er verandert niets (0 regels)
    t := t || 'Anna wijzigt de rit van Bert'::text; v := v || 'gelukt: 0'::text;
    k := k || pg_temp.probeer(anna, format('update public.ritten set cijfer = 1 where id = %s', rit_bert));
    t := t || 'Anna verwijdert de rit van Bert'::text; v := v || 'gelukt: 0'::text;
    k := k || pg_temp.probeer(anna, format('delete from public.ritten where id = %s', rit_bert));
    t := t || 'Anna wijzigt het profiel van Bert'::text; v := v || 'gelukt: 0'::text;
    k := k || pg_temp.probeer(anna, format('update public.profielen set weergavenaam = %L where id = %L', 'Gehackt', bert));
    t := t || 'Anna verwijdert het profiel van Bert'::text; v := v || 'gelukt: 0'::text;
    k := k || pg_temp.probeer(anna, format('delete from public.profielen where id = %L', bert));
    t := t || 'Anna zet haar eigen rit op naam van Bert'::text; v := v || 'geweigerd'::text;
    k := k || pg_temp.probeer(anna, format('update public.ritten set gebruiker = %L where id = %s', bert, rit_anna));
    t := t || 'Anna verandert het id van haar profiel in dat van Bert'::text; v := v || 'geweigerd'::text;
    k := k || pg_temp.probeer(anna, format('update public.profielen set id = %L where id = %L', bert, anna));
    t := t || 'Iemand zonder account wijzigt een rit'::text; v := v || 'geweigerd'::text;
    k := k || pg_temp.probeer(null, format('update public.ritten set cijfer = 1 where id = %s', rit_bert));
    t := t || 'Iemand zonder account verwijdert een rit'::text; v := v || 'geweigerd'::text;
    k := k || pg_temp.probeer(null, format('delete from public.ritten where id = %s', rit_bert));
    t := t || 'De rit van Bert is nog precies hetzelfde'::text; v := v || 'gelukt: 1'::text;
    k := k || pg_temp.probeer(null, format('select 1 from public.ritten where id = %s and gebruiker = %L and cijfer is null', rit_bert, bert));
    t := t || 'Het profiel van Bert is nog precies hetzelfde'::text; v := v || 'gelukt: 1'::text;
    k := k || pg_temp.probeer(null, format('select 1 from public.profielen where id = %L and weergavenaam = %L', bert, 'Test Bert'));

    -- Eigen gegevens wijzigen mag wel
    t := t || 'Anna wijzigt haar eigen rit'::text; v := v || 'gelukt: 1'::text;
    k := k || pg_temp.probeer(anna, format('update public.ritten set cijfer = 9, datum = %L where id = %s', '2006', rit_anna));
    t := t || 'Anna wijzigt haar eigen profiel'::text; v := v || 'gelukt: 1'::text;
    k := k || pg_temp.probeer(anna, format('update public.profielen set weergavenaam = %L, in_ranglijst = false where id = %L', 'Anna B.', anna));

    -- Invoer controleren
    t := t || 'Rit met een achtbaan-code die niet bestaat (HTML)'::text; v := v || 'geweigerd'::text;
    k := k || pg_temp.probeer(anna, 'insert into public.ritten (achtbaan) values (''<img src=x onerror=alert(1)>'')');
    t := t || 'Rit met een te lange achtbaan-code'::text; v := v || 'geweigerd'::text;
    k := k || pg_temp.probeer(anna, format('insert into public.ritten (achtbaan) values (%L)', 'x-' || repeat('a', 120)));
    t := t || 'Rit op 30 februari'::text; v := v || 'geweigerd'::text;
    k := k || pg_temp.probeer(anna, 'insert into public.ritten (achtbaan, datum) values (''Q888394'', ''2023-02-30'')');
    t := t || 'Rit met datum in een rare vorm'::text; v := v || 'geweigerd'::text;
    k := k || pg_temp.probeer(anna, 'insert into public.ritten (achtbaan, datum) values (''Q888394'', ''14-07-2006'')');
    t := t || 'Rit met alleen een jaar en met een maand'::text; v := v || 'gelukt: 2'::text;
    k := k || pg_temp.probeer(anna, 'insert into public.ritten (achtbaan, datum) values (''Q888394'', ''2006''), (''osm-way-976705225'', ''2006-07'')');
    t := t || 'Rit met cijfer 11'::text; v := v || 'geweigerd'::text;
    k := k || pg_temp.probeer(anna, 'insert into public.ritten (achtbaan, cijfer) values (''Q888394'', 11)');
    t := t || 'Rit met een notitie van 201 tekens'::text; v := v || 'geweigerd'::text;
    k := k || pg_temp.probeer(anna, format('insert into public.ritten (achtbaan, notitie) values (%L, %L)', 'Q888394', repeat('a', 201)));
    t := t || 'Gebruikersnaam met hoofdletters en een uitroepteken'::text; v := v || 'geweigerd'::text;
    k := k || pg_temp.probeer(anna, format('update public.profielen set gebruikersnaam = %L where id = %L', 'Anna!', anna));
    t := t || 'Weergavenaam van 41 tekens'::text; v := v || 'geweigerd'::text;
    k := k || pg_temp.probeer(anna, format('update public.profielen set weergavenaam = %L where id = %L', repeat('a', 41), anna));

    -- Account verwijderen
    t := t || 'Iemand zonder account roept "account verwijderen" aan'::text; v := v || 'geweigerd'::text;
    k := k || pg_temp.probeer(null, 'select public.verwijder_mijn_account()');
    t := t || 'Anna verwijdert haar eigen account'::text; v := v || 'gelukt'::text;
    k := k || pg_temp.probeer(anna, 'select public.verwijder_mijn_account()');
    select (select count(*) from auth.users where id = anna)
         + (select count(*) from public.profielen where id = anna)
         + (select count(*) from public.ritten where gebruiker = anna) into n;
    t := t || 'Van Anna is daarna niets meer over (account, profiel, ritten)'::text; v := v || 'gelukt: 0'::text;
    k := k || ('gelukt: ' || n || ' regels');
    select (select count(*) from auth.users where id = bert)
         + (select count(*) from public.profielen where id = bert)
         + (select count(*) from public.ritten where gebruiker = bert) into n;
    t := t || 'Van Bert staat alles er nog (account, profiel, rit)'::text; v := v || 'gelukt: 3'::text;
    k := k || ('gelukt: ' || n || ' regels');

    -- Alles terugdraaien: dit is alleen een test
    raise exception using errcode = 'P0099', message = 'terugdraaien';
  exception when sqlstate 'P0099' then
    null;
  end;

  return query
    select i, t[i], v[i],
      case when k[i] like v[i] || '%' then '✓ goed' else '✗ FOUT: ' || k[i] end
    from generate_subscripts(t, 1) as i
    union all
    select null, 'Totaal', null,
      (select count(*) filter (where k[j] like v[j] || '%') || ' van ' || count(*) || ' goed'
       from generate_subscripts(t, 1) as j)
    order by 1 nulls last;
end $$;

select * from pg_temp.test_beveiliging();
