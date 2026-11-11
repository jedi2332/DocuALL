CREATE TABLE public.vault_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  locked boolean NOT NULL DEFAULT true,
  files jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vault_projects TO authenticated;
GRANT ALL ON public.vault_projects TO service_role;
ALTER TABLE public.vault_projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY vault_own ON public.vault_projects FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.organize_settings (
  user_id uuid PRIMARY KEY,
  folders jsonb NOT NULL DEFAULT '[]'::jsonb,
  rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organize_settings TO authenticated;
GRANT ALL ON public.organize_settings TO service_role;
ALTER TABLE public.organize_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY organize_settings_own ON public.organize_settings FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.organize_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  changes jsonb NOT NULL DEFAULT '[]'::jsonb,
  file_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.organize_runs TO authenticated;
GRANT ALL ON public.organize_runs TO service_role;
ALTER TABLE public.organize_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY organize_runs_own ON public.organize_runs FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);