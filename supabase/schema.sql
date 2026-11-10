-- Rubens Achtbanen: de database voor accounts en credits.
--
-- Zo gebruik je dit bestand: open je project op supabase.com, kies links
-- SQL Editor, dan New query, plak dit hele bestand erin en kies Run.
-- Je mag het later nog een keer draaien (bijvoorbeeld na een update van de
-- site). Bestaande profielen en ritten blijven dan gewoon staan.
--
-- Wat erin staat:
--   profielen  één regel per persoon: weergavenaam, gebruikersnaam, wel of niet in de ranglijst
--   ritten     één regel per rit: wie, welke achtbaan, datum (mag leeg), cijfer, notitie
-- Het e-mailadres staat alleen bij Supabase zelf (auth.users), nooit in deze tabellen.
--
-- Beveiliging (row level security): iedereen mag profielen en ritten lezen,
-- maar alleen de eigenaar mag zijn eigen gegevens toevoegen, wijzigen of verwijderen.


-- ---------------------------------------------------------------------------
-- Hulpfuncties in een eigen schema. Dat schema is niet via de API te bereiken.
-- ---------------------------------------------------------------------------

create schema if not exists intern;
revoke all on schema intern from public;
-- Nodig om de controles hieronder uit te voeren als iemand een rit opslaat
grant usage on schema intern to anon, authenticated, service_role;

-- Geldige datum: leeg, een jaar (2006), een maand (2006-07) of een dag (2006-07-14)
create or replace function intern.geldige_datum(d text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  j int;
  m int;
begin
  if d is null then return true; end if;
  if d !~ '^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$' then return false; end if;
  j := substr(d, 1, 4)::int;
  if j < 1900 or j > 2100 then return false; end if;
  if length(d) = 4 then return true; end if;
  m := substr(d, 6, 2)::int;
  if m < 1 or m > 12 then return false; end if;
  if length(d) = 7 then return true; end if;
  perform make_date(j, m, substr(d, 9, 2)::int); -- geeft een fout bij 30 februari
  return true;
exception when others then
  return false;
end $$;

revoke all on function intern.geldige_datum(text) from public;
grant execute on function intern.geldige_datum(text) to anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- Tabellen
-- ---------------------------------------------------------------------------

create table if not exists public.profielen (
  -- Zelfde id als het account. Verdwijnt het account, dan verdwijnt het profiel ook.
  id uuid primary key references auth.users (id) on delete cascade,
  -- Voor de deellink: profiel.html?wie=gebruikersnaam
  -- 3 tot 24 tekens: kleine letters, cijfers en streepjes, niet aan het begin of eind
  gebruikersnaam text not null unique
    constraint gebruikersnaam_vorm check (
      gebruikersnaam ~ '^[a-z0-9][a-z0-9-]{1,22}[a-z0-9]$' and gebruikersnaam !~ '--'
    ),
  weergavenaam text not null
    constraint weergavenaam_vorm check (
      char_length(weergavenaam) between 1 and 40
      and weergavenaam = btrim(weergavenaam)
      and weergavenaam !~ '[[:cntrl:]]'
    ),
  -- Uit: niet in de ranglijst en niet bij "Ook gereden door". Je profiel blijft
  -- wel te zien voor wie je link heeft.
  in_ranglijst boolean not null default true
);

create table if not exists public.ritten (
  id bigint generated always as identity primary key,
  gebruiker uuid not null default auth.uid()
    references public.profielen (id) on delete cascade,
  -- De code van de achtbaan op de site: Q… (Wikidata), osm-way-… (OpenStreetMap),
  -- x-… (eigen toevoeging), met -1, -2 voor een los spoor
  achtbaan text not null
    constraint achtbaan_vorm check (
      char_length(achtbaan) <= 100
      and achtbaan ~ '^(Q[1-9][0-9]*|osm-(node|way|relation)-[1-9][0-9]*|x-[a-z0-9]+(-[a-z0-9]+)*)(-[1-9][0-9]?)?$'
    ),
  datum text
    constraint datum_vorm check (intern.geldige_datum(datum)),
  cijfer numeric(3, 1)
    constraint cijfer_bereik check (cijfer between 1 and 10),
  notitie text
    constraint notitie_vorm check (
      char_length(notitie) between 1 and 200 and notitie !~ '[[:cntrl:]]'
    )
);

create index if not exists ritten_gebruiker on public.ritten (gebruiker);
create index if not exists ritten_achtbaan on public.ritten (achtbaan);

-- Niemand kan eindeloos ritten toevoegen
create or replace function intern.ritten_grens() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.ritten where gebruiker = new.gebruiker) >= 5000 then
    raise exception 'Je kunt maximaal 5000 ritten bewaren.' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function intern.ritten_grens() from public;

drop trigger if exists ritten_grens on public.ritten;
create trigger ritten_grens before insert on public.ritten
  for each row execute function intern.ritten_grens();


-- ---------------------------------------------------------------------------
-- Wie mag wat (grants). Eerst alles dicht, dan precies openzetten wat nodig is.
-- ---------------------------------------------------------------------------

revoke all on table public.profielen, public.ritten from anon, authenticated;
revoke all on sequence public.ritten_id_seq from anon, authenticated;

-- Lezen mag iedereen, ook wie niet is ingelogd
grant select on table public.profielen, public.ritten to anon, authenticated;

-- Schrijven alleen als je bent ingelogd, en alleen deze kolommen
grant insert (id, gebruikersnaam, weergavenaam, in_ranglijst) on public.profielen to authenticated;
grant update (gebruikersnaam, weergavenaam, in_ranglijst) on public.profielen to authenticated;
grant delete on public.profielen to authenticated;

grant insert (gebruiker, achtbaan, datum, cijfer, notitie) on public.ritten to authenticated;
grant update (achtbaan, datum, cijfer, notitie) on public.ritten to authenticated;
grant delete on public.ritten to authenticated;

grant all on table public.profielen, public.ritten to service_role;


-- ---------------------------------------------------------------------------
-- Row level security: per regel controleren of het van jou is
-- ---------------------------------------------------------------------------

alter table public.profielen enable row level security;
alter table public.ritten enable row level security;

drop policy if exists "Iedereen mag profielen lezen" on public.profielen;
drop policy if exists "Eigen profiel maken" on public.profielen;
drop policy if exists "Eigen profiel wijzigen" on public.profielen;
drop policy if exists "Eigen profiel verwijderen" on public.profielen;

create policy "Iedereen mag profielen lezen" on public.profielen
  for select to anon, authenticated using (true);
create policy "Eigen profiel maken" on public.profielen
  for insert to authenticated with check (id = (select auth.uid()));
create policy "Eigen profiel wijzigen" on public.profielen
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "Eigen profiel verwijderen" on public.profielen
  for delete to authenticated using (id = (select auth.uid()));

drop policy if exists "Iedereen mag ritten lezen" on public.ritten;
drop policy if exists "Eigen ritten toevoegen" on public.ritten;
drop policy if exists "Eigen ritten wijzigen" on public.ritten;
drop policy if exists "Eigen ritten verwijderen" on public.ritten;

create policy "Iedereen mag ritten lezen" on public.ritten
  for select to anon, authenticated using (true);
create policy "Eigen ritten toevoegen" on public.ritten
  for insert to authenticated with check (gebruiker = (select auth.uid()));
create policy "Eigen ritten wijzigen" on public.ritten
  for update to authenticated
  using (gebruiker = (select auth.uid())) with check (gebruiker = (select auth.uid()));
create policy "Eigen ritten verwijderen" on public.ritten
  for delete to authenticated using (gebruiker = (select auth.uid()));


-- ---------------------------------------------------------------------------
-- Je eigen account helemaal verwijderen: ritten, profiel en het account met
-- je e-mailadres. Alleen voor jezelf; er is geen manier om een ander te kiezen.
-- ---------------------------------------------------------------------------

create or replace function public.verwijder_mijn_account() returns void
language plpgsql security definer set search_path = '' as $$
declare
  ik uuid := auth.uid();
begin
  if ik is null then
    raise exception 'Je bent niet ingelogd.' using errcode = '42501';
  end if;
  delete from public.ritten where gebruiker = ik;
  delete from public.profielen where id = ik;
  delete from auth.users where id = ik;
end $$;

revoke all on function public.verwijder_mijn_account() from public, anon;
grant execute on function public.verwijder_mijn_account() to authenticated;
