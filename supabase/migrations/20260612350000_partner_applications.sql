create table if not exists partner_applications (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  contact_name text not null,
  contact_email text not null,
  contact_phone text,
  service_category text not null,
  service_area text not null,
  team_size text not null,
  years_in_business text not null,
  has_insurance boolean default false,
  has_license boolean default false,
  referral_source text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'onboarding')),
  notes text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id)
);

alter table partner_applications enable row level security;

-- Anyone can submit; only service_role reads/updates
create policy "public_insert_partner_applications"
  on partner_applications for insert
  with check (true);

create policy "admin_all_partner_applications"
  on partner_applications for all
  using (auth.role() = 'service_role');
