ALTER TABLE public.vault_projects
  ADD COLUMN IF NOT EXISTS is_capcut boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE POLICY locked_vault_delete_guard ON public.vault_projects
  AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT locked);
--> statement-breakpoint
CREATE FUNCTION public.guard_locked_vault_files()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF jsonb_typeof(NEW.files) IS DISTINCT FROM 'array' OR EXISTS (
    SELECT entry FROM jsonb_array_elements(OLD.files) AS existing(entry)
    EXCEPT ALL
    SELECT entry FROM jsonb_array_elements(NEW.files) AS updated(entry)
  ) THEN
    RAISE EXCEPTION 'Unlock this Vault before removing files.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
--> statement-breakpoint
CREATE TRIGGER locked_vault_file_guard
  BEFORE UPDATE OF files ON public.vault_projects
  FOR EACH ROW WHEN (OLD.locked AND OLD.files IS DISTINCT FROM NEW.files)
  EXECUTE FUNCTION public.guard_locked_vault_files();
--> statement-breakpoint
CREATE FUNCTION public.append_vault_files(p_vault_id uuid, p_files jsonb)
RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH updated AS (
    UPDATE public.vault_projects
      SET files = files || p_files, updated_at = clock_timestamp()
      WHERE id = p_vault_id AND user_id = (SELECT auth.uid()) AND jsonb_typeof(p_files) = 'array'
      RETURNING id
  )
  SELECT EXISTS (SELECT 1 FROM updated)
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.append_vault_files(uuid, jsonb) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.append_vault_files(uuid, jsonb) TO authenticated;
--> statement-breakpoint
CREATE TABLE public.vault_capcut_handoffs (
  id uuid PRIMARY KEY,
  vault_id uuid NOT NULL REFERENCES public.vault_projects(id) ON DELETE CASCADE,
  shared_at timestamptz NOT NULL,
  files jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX vault_capcut_handoffs_vault_id_idx ON public.vault_capcut_handoffs(vault_id);
--> statement-breakpoint
ALTER TABLE public.vault_capcut_handoffs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.vault_capcut_handoffs FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON public.vault_capcut_handoffs TO authenticated;
--> statement-breakpoint
CREATE POLICY capcut_handoffs_select_own ON public.vault_capcut_handoffs
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.vault_projects AS vault
      WHERE vault.id = vault_capcut_handoffs.vault_id AND vault.user_id = (SELECT auth.uid())
    )
  );
--> statement-breakpoint
CREATE FUNCTION public.record_capcut_handoff(
  p_id uuid, p_owner_id uuid, p_vault_id uuid, p_shared_at timestamptz, p_files jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  owner_id uuid := auth.uid();
  vault_files jsonb;
  additions jsonb;
  normalized_files jsonb;
  share_time timestamptz;
BEGIN
  IF owner_id IS NULL OR owner_id IS DISTINCT FROM p_owner_id THEN
    RAISE EXCEPTION 'Vault account changed' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL OR p_vault_id IS NULL OR p_shared_at IS NULL OR NOT isfinite(p_shared_at)
      OR jsonb_typeof(p_files) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid media share' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_files) NOT BETWEEN 1 AND 20 OR octet_length(p_files::text) > 32768 THEN
    RAISE EXCEPTION 'Invalid media share size' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_files) AS f(name text, hash text, size bigint, type text)
    WHERE f.name IS NULL OR length(f.name) NOT BETWEEN 1 AND 240
       OR f.name IN ('.', '..') OR strpos(f.name, '/') > 0 OR strpos(f.name, chr(92)) > 0
       OR f.name ~ '[[:cntrl:]]' OR f.hash IS NULL OR f.hash !~ '^[a-f0-9]{64}$'
       OR f.size IS NULL OR f.size NOT BETWEEN 1 AND 2147483648
       OR f.type IS NULL OR f.type !~ '^(image|video|audio)/[a-z0-9][a-z0-9.+_-]{0,79}$'
  ) THEN
    RAISE EXCEPTION 'Invalid selected media' USING ERRCODE = '22023';
  END IF;

  -- Serialize receipt application and preserve existing Vault entries and lock state.
  SELECT vault.files INTO vault_files
    FROM public.vault_projects AS vault
    WHERE vault.id = p_vault_id AND vault.user_id = owner_id
    FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT jsonb_agg(jsonb_build_object('name', name, 'hash', hash, 'size', size, 'type', type)
                   ORDER BY name, hash) INTO normalized_files
    FROM (
      SELECT DISTINCT ON (f.name, f.hash) f.name, f.hash, f.size, f.type
      FROM jsonb_to_recordset(p_files) AS f(name text, hash text, size bigint, type text)
      ORDER BY f.name, f.hash, f.size, f.type
    ) AS media;

  share_time := least(p_shared_at, clock_timestamp());
  INSERT INTO public.vault_capcut_handoffs (id, vault_id, shared_at, files)
    VALUES (p_id, p_vault_id, share_time, normalized_files)
    ON CONFLICT (id) DO NOTHING;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.vault_capcut_handoffs
               WHERE id = p_id AND vault_id = p_vault_id) THEN
      -- A receipt replay must not re-add media deliberately removed afterward.
      RETURN true;
    END IF;
    RAISE EXCEPTION 'Invalid media receipt' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_agg(entry || jsonb_build_object('path', entry->>'name')
                   ORDER BY entry->>'name', entry->>'hash') INTO additions
    FROM jsonb_array_elements(normalized_files) AS picked(entry)
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(vault_files) AS current_file(value)
      WHERE current_file.value->>'path' = entry->>'name'
        AND current_file.value->>'hash' = entry->>'hash'
    );

  IF additions IS NOT NULL THEN
    UPDATE public.vault_projects
      SET files = vault_files || additions, updated_at = clock_timestamp()
      WHERE id = p_vault_id AND user_id = owner_id;
  END IF;
  RETURN true;
END;
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.record_capcut_handoff(uuid, uuid, uuid, timestamptz, jsonb)
  FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.record_capcut_handoff(uuid, uuid, uuid, timestamptz, jsonb)
  TO authenticated;
--> statement-breakpoint
CREATE FUNCTION public.list_capcut_vault_tags(p_vault_id uuid)
RETURNS TABLE(file_path text, file_hash text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT DISTINCT f.value->>'name', f.value->>'hash'
  FROM public.vault_capcut_handoffs AS receipt
  CROSS JOIN LATERAL jsonb_array_elements(receipt.files) AS f(value)
  WHERE receipt.vault_id = p_vault_id
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.list_capcut_vault_tags(uuid) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.list_capcut_vault_tags(uuid) TO authenticated;
