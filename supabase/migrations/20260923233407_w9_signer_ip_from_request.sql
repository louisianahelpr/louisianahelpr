-- Q319 (2026-09-23): the W-9 signature's IP is stamped server-side.
--
-- W9CollectionDialog fetched api.ipify.org from the browser, which the CSP's
-- connect-src blocks, so no signature ever carried an IP (prod: 0 rows, 0 with
-- an IP, read 2026-09-23). A client-supplied IP is also whatever the client
-- chooses to send. The trigger overwrites NEW.ip with the first address in the
-- request's X-Forwarded-For as PostgREST passes it in request.headers, and
-- leaves it NULL when there is no request (a server-side insert).

CREATE OR REPLACE FUNCTION public.stamp_w9_signer_ip()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_headers jsonb;
  v_ip text;
BEGIN
  BEGIN
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  EXCEPTION WHEN others THEN
    v_headers := NULL;
  END;
  v_ip := nullif(btrim(split_part(COALESCE(v_headers->>'x-forwarded-for', ''), ',', 1)), '');
  NEW.ip := COALESCE(v_ip, nullif(btrim(COALESCE(v_headers->>'cf-connecting-ip', '')), ''));
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_w9_signer_ip() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_stamp_w9_signer_ip ON public.helper_w9_records;
CREATE TRIGGER trg_stamp_w9_signer_ip
  BEFORE INSERT ON public.helper_w9_records
  FOR EACH ROW EXECUTE FUNCTION public.stamp_w9_signer_ip();
