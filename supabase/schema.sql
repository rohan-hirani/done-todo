-- Done: tasks table. RLS is enabled with NO policies: only the service role
-- (used by the Vercel API routes) can read/write. The browser never talks to Supabase.
create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(title) between 1 and 500),
  date        date,                          -- null = Someday
  done        boolean not null default false,
  done_at     timestamptz,
  position    double precision not null default (extract(epoch from clock_timestamp()) * 1000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  source      text not null default 'app'
);
create index if not exists tasks_date_idx on public.tasks (date);
create index if not exists tasks_created_idx on public.tasks (created_at desc);
alter table public.tasks enable row level security;
