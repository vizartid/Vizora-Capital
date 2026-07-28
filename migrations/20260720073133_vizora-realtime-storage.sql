CREATE OR REPLACE FUNCTION public.asset_business_id(p_key TEXT)
RETURNS UUID
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN NULLIF((storage.foldername(p_key))[1], '')::UUID;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END;
$$;

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

CREATE POLICY finance_business_assets_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket = 'business-assets'
    AND public.is_business_member(public.asset_business_id(key))
  );

CREATE POLICY finance_business_assets_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket = 'business-assets'
    AND uploaded_by = (SELECT auth.jwt() ->> 'sub')
    AND public.is_business_member(public.asset_business_id(key))
  );

CREATE POLICY finance_business_assets_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket = 'business-assets'
    AND public.is_business_member(public.asset_business_id(key))
    AND (
      uploaded_by = (SELECT auth.jwt() ->> 'sub')
      OR public.has_business_role(public.asset_business_id(key), ARRAY['administrator', 'finance'])
    )
  )
  WITH CHECK (
    bucket = 'business-assets'
    AND public.is_business_member(public.asset_business_id(key))
  );

CREATE POLICY finance_business_assets_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket = 'business-assets'
    AND public.is_business_member(public.asset_business_id(key))
    AND (
      uploaded_by = (SELECT auth.jwt() ->> 'sub')
      OR public.has_business_role(public.asset_business_id(key), ARRAY['administrator', 'finance'])
    )
  );

GRANT USAGE ON SCHEMA storage TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;

CREATE OR REPLACE FUNCTION public.can_access_business_channel(p_channel_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE v_business_id UUID;
BEGIN
  IF p_channel_name !~ '^business:[0-9a-fA-F-]{36}$' THEN RETURN FALSE; END IF;
  v_business_id := split_part(p_channel_name, ':', 2)::UUID;
  RETURN public.is_business_member(v_business_id);
EXCEPTION WHEN invalid_text_representation THEN
  RETURN FALSE;
END;
$$;

INSERT INTO realtime.channels (pattern, description, enabled)
VALUES ('business:%', 'Tenant-scoped finance updates', TRUE)
ON CONFLICT (pattern) DO UPDATE
SET description = EXCLUDED.description, enabled = EXCLUDED.enabled;

ALTER TABLE realtime.channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY finance_business_channels_select ON realtime.channels
  FOR SELECT TO authenticated
  USING (
    pattern = 'business:%'
    AND public.can_access_business_channel(realtime.channel_name())
  );

CREATE OR REPLACE FUNCTION public.publish_finance_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_row JSONB := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_business_id UUID := (v_row ->> 'business_id')::UUID;
BEGIN
  PERFORM realtime.publish(
    'business:' || v_business_id::TEXT,
    'finance_changed',
    jsonb_build_object(
      'table', TG_TABLE_NAME,
      'operation', lower(TG_OP),
      'id', v_row ->> 'id',
      'status', v_row ->> 'status'
    )
  );
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER invoices_realtime
  AFTER INSERT OR UPDATE OR DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.publish_finance_change();
CREATE TRIGGER transactions_realtime
  AFTER INSERT OR UPDATE OR DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.publish_finance_change();
CREATE TRIGGER action_drafts_realtime
  AFTER INSERT OR UPDATE OR DELETE ON public.action_drafts
  FOR EACH ROW EXECUTE FUNCTION public.publish_finance_change();

CREATE OR REPLACE FUNCTION public.rebuild_invoice_reminders()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_days INTEGER;
  v_timezone TEXT;
BEGIN
  UPDATE public.invoice_reminders
  SET status = 'cancelled'
  WHERE invoice_id = NEW.id AND status = 'pending';

  IF NOT NEW.reminder_enabled OR NEW.status IN ('paid', 'void') THEN RETURN NEW; END IF;
  SELECT timezone INTO v_timezone FROM public.businesses WHERE id = NEW.business_id;

  FOREACH v_days IN ARRAY NEW.reminder_days_before LOOP
    INSERT INTO public.invoice_reminders (
      business_id, invoice_id, reminder_type, scheduled_for
    ) VALUES (
      NEW.business_id,
      NEW.id,
      'before_due',
      ((NEW.due_date - v_days) + TIME '09:00') AT TIME ZONE COALESCE(v_timezone, 'Asia/Jakarta')
    ) ON CONFLICT DO NOTHING;
  END LOOP;

  FOREACH v_days IN ARRAY NEW.reminder_days_after LOOP
    INSERT INTO public.invoice_reminders (
      business_id, invoice_id, reminder_type, scheduled_for
    ) VALUES (
      NEW.business_id,
      NEW.id,
      'after_due',
      ((NEW.due_date + v_days) + TIME '09:00') AT TIME ZONE COALESCE(v_timezone, 'Asia/Jakarta')
    ) ON CONFLICT DO NOTHING;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER invoices_rebuild_reminders
  AFTER INSERT OR UPDATE OF due_date, reminder_enabled, reminder_days_before, reminder_days_after, status
  ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.rebuild_invoice_reminders();
