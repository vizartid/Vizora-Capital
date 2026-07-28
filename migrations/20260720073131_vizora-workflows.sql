CREATE OR REPLACE FUNCTION public.is_business_member(p_business_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.business_members bm
    WHERE bm.business_id = p_business_id
      AND bm.user_id = (SELECT auth.uid())
      AND bm.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.has_business_role(p_business_id UUID, p_roles TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.business_members bm
    WHERE bm.business_id = p_business_id
      AND bm.user_id = (SELECT auth.uid())
      AND bm.status = 'active'
      AND bm.role = ANY (p_roles)
  );
$$;

CREATE OR REPLACE FUNCTION public.current_business_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT bm.business_id
  FROM public.business_members bm
  WHERE bm.user_id = (SELECT auth.uid()) AND bm.status = 'active'
  ORDER BY bm.joined_at
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.write_audit_log(
  p_business_id UUID,
  p_actor_type TEXT,
  p_action TEXT,
  p_entity_type TEXT,
  p_entity_id UUID,
  p_summary TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  INSERT INTO public.audit_logs (
    business_id, actor_type, actor_user_id, action, entity_type, entity_id, summary, metadata
  ) VALUES (
    p_business_id,
    p_actor_type,
    CASE WHEN p_actor_type = 'user' THEN (SELECT auth.uid()) ELSE NULL END,
    p_action,
    p_entity_type,
    p_entity_id,
    p_summary,
    COALESCE(p_metadata, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.write_audit_log(UUID, TEXT, TEXT, TEXT, UUID, TEXT, JSONB) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.prevent_tenant_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.business_id IS DISTINCT FROM OLD.business_id THEN
    RAISE EXCEPTION 'business_id cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.calculate_invoice_item()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_invoice_business UUID;
BEGIN
  SELECT business_id INTO v_invoice_business
  FROM public.invoices
  WHERE id = NEW.invoice_id;

  IF v_invoice_business IS NULL OR v_invoice_business <> NEW.business_id THEN
    RAISE EXCEPTION 'Invoice item business does not match invoice business';
  END IF;

  IF NEW.item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.items
    WHERE id = NEW.item_id AND business_id = NEW.business_id
  ) THEN
    RAISE EXCEPTION 'Catalog item does not belong to this business';
  END IF;

  NEW.line_subtotal := ROUND(NEW.quantity * NEW.unit_price, 2);
  NEW.line_discount := ROUND(NEW.line_subtotal * NEW.discount_rate / 100, 2);
  NEW.line_tax := ROUND((NEW.line_subtotal - NEW.line_discount) * NEW.tax_rate / 100, 2);
  NEW.line_total := NEW.line_subtotal - NEW.line_discount + NEW.line_tax;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_invoice_totals()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_invoice_id UUID := COALESCE(NEW.invoice_id, OLD.invoice_id);
BEGIN
  UPDATE public.invoices i
  SET subtotal = totals.subtotal,
      discount_amount = totals.discount_amount,
      tax_amount = totals.tax_amount,
      total_amount = totals.total_amount
  FROM (
    SELECT
      COALESCE(SUM(line_subtotal), 0)::NUMERIC(18,2) AS subtotal,
      COALESCE(SUM(line_discount), 0)::NUMERIC(18,2) AS discount_amount,
      COALESCE(SUM(line_tax), 0)::NUMERIC(18,2) AS tax_amount,
      COALESCE(SUM(line_total), 0)::NUMERIC(18,2) AS total_amount
    FROM public.invoice_items
    WHERE invoice_id = v_invoice_id
  ) totals
  WHERE i.id = v_invoice_id;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_invoice_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.invoice_status_history (
      business_id, invoice_id, from_status, to_status, changed_by
    ) VALUES (
      NEW.business_id, NEW.id, OLD.status, NEW.status, (SELECT auth.uid())
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_row_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_row JSONB := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_business_id UUID := (v_row ->> 'business_id')::UUID;
  v_entity_id UUID := NULLIF(v_row ->> 'id', '')::UUID;
  v_actor_type TEXT := CASE WHEN (SELECT auth.uid()) IS NULL THEN 'system' ELSE 'user' END;
BEGIN
  IF (to_jsonb(NEW) - 'updated_at' - 'invoice_sequence') IS NOT DISTINCT FROM
     (to_jsonb(OLD) - 'updated_at' - 'invoice_sequence') THEN
    RETURN NEW;
  END IF;
  PERFORM public.write_audit_log(
    v_business_id,
    v_actor_type,
    lower(TG_OP),
    TG_TABLE_NAME,
    v_entity_id,
    initcap(replace(TG_TABLE_NAME, '_', ' ')) || ' ' || lower(TG_OP),
    jsonb_build_object('operation', TG_OP)
  );
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_business_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF (to_jsonb(NEW) - 'updated_at' - 'invoice_sequence') IS NOT DISTINCT FROM
     (to_jsonb(OLD) - 'updated_at' - 'invoice_sequence') THEN
    RETURN NEW;
  END IF;
  PERFORM public.write_audit_log(
    NEW.id,
    CASE WHEN (SELECT auth.uid()) IS NULL THEN 'system' ELSE 'user' END,
    'update',
    'businesses',
    NEW.id,
    'Business settings updated',
    '{}'::jsonb
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER invoice_items_calculate
  BEFORE INSERT OR UPDATE ON public.invoice_items
  FOR EACH ROW EXECUTE FUNCTION public.calculate_invoice_item();

CREATE TRIGGER invoice_items_refresh_totals
  AFTER INSERT OR UPDATE OR DELETE ON public.invoice_items
  FOR EACH ROW EXECUTE FUNCTION public.refresh_invoice_totals();

CREATE TRIGGER invoices_status_history
  AFTER UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.record_invoice_status_change();

CREATE TRIGGER customers_tenant_guard BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_change();
CREATE TRIGGER items_tenant_guard BEFORE UPDATE ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_change();
CREATE TRIGGER business_members_tenant_guard BEFORE UPDATE ON public.business_members
  FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_change();
CREATE TRIGGER business_invitations_tenant_guard BEFORE UPDATE ON public.business_invitations
  FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_change();
CREATE TRIGGER chat_sessions_tenant_guard BEFORE UPDATE ON public.chat_sessions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_change();

CREATE TRIGGER customers_audit AFTER INSERT OR UPDATE OR DELETE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER items_audit AFTER INSERT OR UPDATE OR DELETE ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER invoices_audit AFTER INSERT OR UPDATE OR DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER transactions_audit AFTER INSERT OR UPDATE OR DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER action_drafts_audit AFTER INSERT OR UPDATE OR DELETE ON public.action_drafts
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER business_invitations_audit AFTER INSERT OR UPDATE OR DELETE ON public.business_invitations
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER business_members_audit AFTER INSERT OR UPDATE OR DELETE ON public.business_members
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();
CREATE TRIGGER businesses_audit AFTER UPDATE ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.audit_business_change();

CREATE OR REPLACE FUNCTION public.create_business(
  p_name TEXT,
  p_industry TEXT DEFAULT NULL,
  p_team_size TEXT DEFAULT NULL,
  p_country TEXT DEFAULT 'Indonesia',
  p_currency TEXT DEFAULT 'IDR',
  p_display_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id UUID := (SELECT auth.uid());
  v_business public.businesses;
  v_email TEXT := COALESCE((SELECT auth.jwt() ->> 'email'), 'member@unknown.local');
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  INSERT INTO public.businesses (name, industry, team_size, country, currency, created_by)
  VALUES (trim(p_name), p_industry, p_team_size, COALESCE(p_country, 'Indonesia'), upper(p_currency), v_user_id)
  RETURNING * INTO v_business;

  INSERT INTO public.business_members (business_id, user_id, email, display_name, role)
  VALUES (
    v_business.id,
    v_user_id,
    lower(v_email),
    COALESCE(NULLIF(trim(p_display_name), ''), split_part(v_email, '@', 1)),
    'administrator'
  );

  PERFORM public.write_audit_log(
    v_business.id, 'user', 'create', 'businesses', v_business.id,
    'Business workspace created', '{}'::jsonb
  );
  RETURN to_jsonb(v_business);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_invoice_draft(
  p_business_id UUID,
  p_customer_id UUID,
  p_due_date DATE,
  p_items JSONB,
  p_notes TEXT DEFAULT NULL,
  p_source TEXT DEFAULT 'manual',
  p_ai_action_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user_id UUID := (SELECT auth.uid());
  v_sequence INTEGER;
  v_prefix TEXT;
  v_invoice public.invoices;
  v_item JSONB;
BEGIN
  IF NOT public.has_business_role(p_business_id, ARRAY['administrator', 'approver', 'finance']) THEN
    RAISE EXCEPTION 'Insufficient role to create invoice';
  END IF;
  IF p_due_date < CURRENT_DATE THEN RAISE EXCEPTION 'Due date cannot be in the past'; END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Invoice requires at least one item';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.customers WHERE id = p_customer_id AND business_id = p_business_id AND is_active
  ) THEN RAISE EXCEPTION 'Customer not found in business'; END IF;

  UPDATE public.businesses
  SET invoice_sequence = invoice_sequence + 1
  WHERE id = p_business_id
  RETURNING invoice_sequence, invoice_prefix INTO v_sequence, v_prefix;

  INSERT INTO public.invoices (
    business_id, customer_id, invoice_number, due_date, notes, source, created_by, ai_action_id
  ) VALUES (
    p_business_id,
    p_customer_id,
    v_prefix || '-' || to_char(CURRENT_DATE, 'YYYY') || '-' || lpad(v_sequence::TEXT, 4, '0'),
    p_due_date,
    p_notes,
    p_source,
    v_user_id,
    p_ai_action_id
  ) RETURNING * INTO v_invoice;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO public.invoice_items (
      business_id, invoice_id, item_id, description, quantity, unit_price,
      discount_rate, tax_rate, sort_order
    ) VALUES (
      p_business_id,
      v_invoice.id,
      NULLIF(v_item ->> 'item_id', '')::UUID,
      COALESCE(NULLIF(v_item ->> 'description', ''), 'Item invoice'),
      COALESCE((v_item ->> 'quantity')::NUMERIC, 1),
      COALESCE((v_item ->> 'unit_price')::NUMERIC, 0),
      COALESCE((v_item ->> 'discount_rate')::NUMERIC, 0),
      COALESCE((v_item ->> 'tax_rate')::NUMERIC, 0),
      COALESCE((v_item ->> 'sort_order')::INTEGER, 0)
    );
  END LOOP;

  SELECT * INTO v_invoice FROM public.invoices WHERE id = v_invoice.id;
  RETURN to_jsonb(v_invoice);
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_invoice(p_invoice_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_invoice public.invoices;
BEGIN
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF v_invoice.id IS NULL OR NOT public.has_business_role(v_invoice.business_id, ARRAY['administrator', 'approver']) THEN
    RAISE EXCEPTION 'Invoice not found or approval not permitted';
  END IF;
  IF v_invoice.status <> 'draft' THEN RAISE EXCEPTION 'Only draft invoices can be approved'; END IF;
  IF v_invoice.total_amount <= 0 THEN RAISE EXCEPTION 'Invoice total must be greater than zero'; END IF;

  UPDATE public.invoices
  SET status = 'approved', approved_by = (SELECT auth.uid()), approved_at = NOW()
  WHERE id = p_invoice_id
  RETURNING * INTO v_invoice;
  RETURN to_jsonb(v_invoice);
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_invoice_sent(p_invoice_id UUID, p_provider_message_id TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_invoice public.invoices;
BEGIN
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF v_invoice.id IS NULL OR NOT public.has_business_role(v_invoice.business_id, ARRAY['administrator', 'approver']) THEN
    RAISE EXCEPTION 'Invoice not found or send not permitted';
  END IF;
  IF v_invoice.status <> 'approved' THEN RAISE EXCEPTION 'Invoice must be approved before sending'; END IF;

  UPDATE public.invoices SET status = 'sent', sent_at = NOW()
  WHERE id = p_invoice_id RETURNING * INTO v_invoice;
  PERFORM public.write_audit_log(
    v_invoice.business_id, 'user', 'send', 'invoices', v_invoice.id,
    'Invoice sent to customer', jsonb_build_object('provider_message_id', p_provider_message_id)
  );
  RETURN to_jsonb(v_invoice);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_transaction(
  p_business_id UUID,
  p_type TEXT,
  p_name TEXT,
  p_category TEXT,
  p_amount NUMERIC,
  p_transaction_date DATE DEFAULT CURRENT_DATE,
  p_invoice_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_transaction public.transactions;
  v_invoice public.invoices;
BEGIN
  IF NOT public.has_business_role(p_business_id, ARRAY['administrator', 'approver', 'finance']) THEN
    RAISE EXCEPTION 'Insufficient role to record transaction';
  END IF;
  IF p_type NOT IN ('income', 'expense') OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid transaction';
  END IF;
  IF p_invoice_id IS NOT NULL THEN
    SELECT * INTO v_invoice FROM public.invoices
    WHERE id = p_invoice_id AND business_id = p_business_id FOR UPDATE;
    IF v_invoice.id IS NULL THEN RAISE EXCEPTION 'Invoice not found in business'; END IF;
  END IF;

  INSERT INTO public.transactions (
    business_id, invoice_id, type, name, category, amount, transaction_date, notes, created_by
  ) VALUES (
    p_business_id, p_invoice_id, p_type, trim(p_name), trim(p_category), p_amount,
    COALESCE(p_transaction_date, CURRENT_DATE), p_notes, (SELECT auth.uid())
  ) RETURNING * INTO v_transaction;

  IF p_type = 'income' AND p_invoice_id IS NOT NULL THEN
    UPDATE public.invoices
    SET amount_paid = LEAST(total_amount, amount_paid + p_amount),
        status = CASE WHEN amount_paid + p_amount >= total_amount THEN 'paid' ELSE status END,
        paid_at = CASE WHEN amount_paid + p_amount >= total_amount THEN NOW() ELSE paid_at END
    WHERE id = p_invoice_id;
  END IF;
  RETURN to_jsonb(v_transaction);
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_ai_action(p_action_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_action public.action_drafts;
  v_result JSONB;
  v_entity_id UUID;
BEGIN
  SELECT * INTO v_action FROM public.action_drafts WHERE id = p_action_id FOR UPDATE;
  IF v_action.id IS NULL OR NOT public.has_business_role(v_action.business_id, ARRAY['administrator', 'approver']) THEN
    RAISE EXCEPTION 'Action not found or approval not permitted';
  END IF;
  IF v_action.status <> 'pending' THEN RAISE EXCEPTION 'Action is not pending'; END IF;
  IF v_action.expires_at <= NOW() THEN RAISE EXCEPTION 'Action draft has expired'; END IF;

  IF v_action.action_type = 'create_invoice' THEN
    v_result := public.create_invoice_draft(
      v_action.business_id,
      (v_action.payload ->> 'customer_id')::UUID,
      (v_action.payload ->> 'due_date')::DATE,
      v_action.payload -> 'items',
      v_action.payload ->> 'notes',
      'ai',
      v_action.id
    );
    v_entity_id := (v_result ->> 'id')::UUID;
  ELSIF v_action.action_type = 'create_transaction' THEN
    v_result := public.record_transaction(
      v_action.business_id,
      v_action.payload ->> 'type',
      v_action.payload ->> 'name',
      v_action.payload ->> 'category',
      (v_action.payload ->> 'amount')::NUMERIC,
      COALESCE((v_action.payload ->> 'transaction_date')::DATE, CURRENT_DATE),
      NULLIF(v_action.payload ->> 'invoice_id', '')::UUID,
      v_action.payload ->> 'notes'
    );
    v_entity_id := (v_result ->> 'id')::UUID;
  ELSE
    v_result := jsonb_build_object('approved', true, 'action_type', v_action.action_type);
  END IF;

  UPDATE public.action_drafts
  SET status = 'approved', approved_by = (SELECT auth.uid()), approved_at = NOW(), executed_entity_id = v_entity_id
  WHERE id = v_action.id;

  PERFORM public.write_audit_log(
    v_action.business_id, 'user', 'approve', 'action_drafts', v_action.id,
    'AI action reviewed and approved', jsonb_build_object('executed_entity_id', v_entity_id)
  );
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_ai_action(p_action_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_action public.action_drafts;
BEGIN
  SELECT * INTO v_action FROM public.action_drafts WHERE id = p_action_id FOR UPDATE;
  IF v_action.id IS NULL OR (
    v_action.requested_by <> (SELECT auth.uid())
    AND NOT public.has_business_role(v_action.business_id, ARRAY['administrator', 'approver'])
  ) THEN RAISE EXCEPTION 'Action not found or rejection not permitted'; END IF;
  IF v_action.status <> 'pending' THEN RAISE EXCEPTION 'Action is not pending'; END IF;

  UPDATE public.action_drafts
  SET status = 'rejected', rejected_by = (SELECT auth.uid()), rejected_at = NOW()
  WHERE id = p_action_id;
  RETURN jsonb_build_object('id', p_action_id, 'status', 'rejected');
END;
$$;

CREATE OR REPLACE FUNCTION public.invite_business_member(p_business_id UUID, p_email TEXT, p_role TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE v_invitation public.business_invitations;
BEGIN
  IF NOT public.has_business_role(p_business_id, ARRAY['administrator']) THEN
    RAISE EXCEPTION 'Only administrators can invite members';
  END IF;
  IF p_role NOT IN ('administrator', 'approver', 'finance', 'viewer') THEN RAISE EXCEPTION 'Invalid role'; END IF;

  INSERT INTO public.business_invitations (business_id, email, role, invited_by)
  VALUES (p_business_id, lower(trim(p_email)), p_role, (SELECT auth.uid()))
  ON CONFLICT (business_id, lower(email)) WHERE status = 'pending'
  DO UPDATE SET role = EXCLUDED.role, invited_by = EXCLUDED.invited_by,
                expires_at = NOW() + INTERVAL '7 days'
  RETURNING * INTO v_invitation;
  RETURN to_jsonb(v_invitation);
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_business_invitation(p_invitation_id UUID, p_display_name TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_invitation public.business_invitations;
  v_user_id UUID := (SELECT auth.uid());
  v_email TEXT := lower(COALESCE((SELECT auth.jwt() ->> 'email'), ''));
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_invitation FROM public.business_invitations
  WHERE id = p_invitation_id AND status = 'pending' FOR UPDATE;
  IF v_invitation.id IS NULL OR lower(v_invitation.email) <> v_email OR v_invitation.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation is invalid or expired';
  END IF;

  INSERT INTO public.business_members (business_id, user_id, email, display_name, role)
  VALUES (
    v_invitation.business_id, v_user_id, v_email,
    COALESCE(NULLIF(trim(p_display_name), ''), split_part(v_email, '@', 1)), v_invitation.role
  )
  ON CONFLICT (business_id, user_id) DO UPDATE
    SET status = 'active', role = EXCLUDED.role, display_name = EXCLUDED.display_name;

  UPDATE public.business_invitations SET status = 'accepted', accepted_at = NOW()
  WHERE id = v_invitation.id;
  RETURN jsonb_build_object('business_id', v_invitation.business_id, 'role', v_invitation.role);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_dashboard_summary(p_business_id UUID, p_month DATE DEFAULT CURRENT_DATE)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE v_start DATE := date_trunc('month', p_month)::DATE; v_end DATE := (date_trunc('month', p_month) + INTERVAL '1 month')::DATE;
BEGIN
  IF NOT public.is_business_member(p_business_id) THEN RAISE EXCEPTION 'Business access denied'; END IF;
  RETURN jsonb_build_object(
    'income', COALESCE((SELECT SUM(amount) FROM public.transactions WHERE business_id = p_business_id AND type = 'income' AND transaction_date >= v_start AND transaction_date < v_end), 0),
    'expense', COALESCE((SELECT SUM(amount) FROM public.transactions WHERE business_id = p_business_id AND type = 'expense' AND transaction_date >= v_start AND transaction_date < v_end), 0),
    'receivables', COALESCE((SELECT SUM(total_amount - amount_paid) FROM public.invoices WHERE business_id = p_business_id AND status IN ('approved', 'sent')), 0),
    'unpaid_count', (SELECT COUNT(*) FROM public.invoices WHERE business_id = p_business_id AND status IN ('approved', 'sent')),
    'draft_count', (SELECT COUNT(*) FROM public.invoices WHERE business_id = p_business_id AND status = 'draft'),
    'overdue_count', (SELECT COUNT(*) FROM public.invoices WHERE business_id = p_business_id AND status IN ('approved', 'sent') AND due_date < CURRENT_DATE AND amount_paid < total_amount),
    'overdue_amount', COALESCE((SELECT SUM(total_amount - amount_paid) FROM public.invoices WHERE business_id = p_business_id AND status IN ('approved', 'sent') AND due_date < CURRENT_DATE AND amount_paid < total_amount), 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_ai_finance_context(p_business_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT public.is_business_member(p_business_id) THEN RAISE EXCEPTION 'Business access denied'; END IF;
  RETURN jsonb_build_object(
    'business', (SELECT jsonb_build_object('id', id, 'name', name, 'currency', currency, 'default_tax_rate', default_tax_rate) FROM public.businesses WHERE id = p_business_id),
    'summary', public.get_dashboard_summary(p_business_id, CURRENT_DATE),
    'customers', COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM (SELECT id, name, contact_email FROM public.customers WHERE business_id = p_business_id AND is_active ORDER BY name LIMIT 100) c), '[]'::jsonb),
    'items', COALESCE((SELECT jsonb_agg(to_jsonb(i)) FROM (SELECT id, name, description, standard_price, default_tax_rate FROM public.items WHERE business_id = p_business_id AND is_active ORDER BY name LIMIT 100) i), '[]'::jsonb),
    'open_invoices', COALESCE((SELECT jsonb_agg(to_jsonb(i)) FROM (
      SELECT inv.id, inv.invoice_number, c.name AS customer, inv.status,
             CASE WHEN inv.status IN ('approved', 'sent') AND inv.due_date < CURRENT_DATE THEN 'overdue' ELSE inv.status END AS effective_status,
             inv.due_date, inv.total_amount, inv.amount_paid
      FROM public.invoices inv JOIN public.customers c ON c.id = inv.customer_id
      WHERE inv.business_id = p_business_id AND inv.status IN ('draft', 'approved', 'sent')
      ORDER BY inv.due_date LIMIT 100
    ) i), '[]'::jsonb),
    'recent_transactions', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM (
      SELECT type, name, category, amount, transaction_date FROM public.transactions
      WHERE business_id = p_business_id ORDER BY transaction_date DESC, created_at DESC LIMIT 50
    ) t), '[]'::jsonb)
  );
END;
$$;

CREATE VIEW public.invoice_overview
WITH (security_invoker = true)
AS
SELECT
  i.*,
  c.name AS customer_name,
  c.contact_email AS customer_email,
  CASE
    WHEN i.status IN ('approved', 'sent') AND i.due_date < CURRENT_DATE AND i.amount_paid < i.total_amount THEN 'overdue'
    ELSE i.status
  END AS effective_status,
  GREATEST(i.total_amount - i.amount_paid, 0) AS outstanding_amount
FROM public.invoices i
JOIN public.customers c ON c.id = i.customer_id;

CREATE VIEW public.customer_overview
WITH (security_invoker = true)
AS
SELECT
  c.*,
  COUNT(i.id) AS invoice_count,
  COALESCE(SUM(i.total_amount), 0)::NUMERIC(18,2) AS total_billed,
  COALESCE(SUM(CASE WHEN i.status IN ('approved', 'sent') THEN i.total_amount - i.amount_paid ELSE 0 END), 0)::NUMERIC(18,2) AS outstanding_amount
FROM public.customers c
LEFT JOIN public.invoices i ON i.customer_id = c.id
GROUP BY c.id;

ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.action_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY businesses_select ON public.businesses FOR SELECT TO authenticated
  USING (public.is_business_member(id));
CREATE POLICY businesses_update ON public.businesses FOR UPDATE TO authenticated
  USING (public.has_business_role(id, ARRAY['administrator']))
  WITH CHECK (public.has_business_role(id, ARRAY['administrator']));

CREATE POLICY business_members_select ON public.business_members FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));
CREATE POLICY business_members_update ON public.business_members FOR UPDATE TO authenticated
  USING (public.has_business_role(business_id, ARRAY['administrator']))
  WITH CHECK (public.has_business_role(business_id, ARRAY['administrator']));

CREATE POLICY business_invitations_select ON public.business_invitations FOR SELECT TO authenticated
  USING (public.has_business_role(business_id, ARRAY['administrator']) OR lower(email) = lower(COALESCE((SELECT auth.jwt() ->> 'email'), '')));

CREATE POLICY customers_select ON public.customers FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));
CREATE POLICY customers_insert ON public.customers FOR INSERT TO authenticated
  WITH CHECK (public.has_business_role(business_id, ARRAY['administrator', 'finance']) AND created_by = (SELECT auth.uid()));
CREATE POLICY customers_update ON public.customers FOR UPDATE TO authenticated
  USING (public.has_business_role(business_id, ARRAY['administrator', 'finance']))
  WITH CHECK (public.has_business_role(business_id, ARRAY['administrator', 'finance']));
CREATE POLICY customers_delete ON public.customers FOR DELETE TO authenticated
  USING (public.has_business_role(business_id, ARRAY['administrator', 'finance']));

CREATE POLICY items_select ON public.items FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));
CREATE POLICY items_insert ON public.items FOR INSERT TO authenticated
  WITH CHECK (public.has_business_role(business_id, ARRAY['administrator', 'finance']) AND created_by = (SELECT auth.uid()));
CREATE POLICY items_update ON public.items FOR UPDATE TO authenticated
  USING (public.has_business_role(business_id, ARRAY['administrator', 'finance']))
  WITH CHECK (public.has_business_role(business_id, ARRAY['administrator', 'finance']));
CREATE POLICY items_delete ON public.items FOR DELETE TO authenticated
  USING (public.has_business_role(business_id, ARRAY['administrator', 'finance']));

CREATE POLICY invoices_select ON public.invoices FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));
CREATE POLICY invoice_items_select ON public.invoice_items FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));
CREATE POLICY transactions_select ON public.transactions FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));
CREATE POLICY invoice_status_history_select ON public.invoice_status_history FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));
CREATE POLICY audit_logs_select ON public.audit_logs FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));
CREATE POLICY invoice_reminders_select ON public.invoice_reminders FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));

CREATE POLICY chat_sessions_select ON public.chat_sessions FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND public.is_business_member(business_id));
CREATE POLICY chat_sessions_insert ON public.chat_sessions FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND public.is_business_member(business_id));
CREATE POLICY chat_sessions_update ON public.chat_sessions FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND public.is_business_member(business_id))
  WITH CHECK (user_id = (SELECT auth.uid()) AND public.is_business_member(business_id));
CREATE POLICY chat_sessions_delete ON public.chat_sessions FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND public.is_business_member(business_id));

CREATE POLICY chat_messages_select ON public.chat_messages FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND public.is_business_member(business_id));
CREATE POLICY action_drafts_select ON public.action_drafts FOR SELECT TO authenticated
  USING (
    public.is_business_member(business_id)
    AND (requested_by = (SELECT auth.uid()) OR public.has_business_role(business_id, ARRAY['administrator', 'approver']))
  );

GRANT USAGE ON SCHEMA public TO authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
GRANT SELECT ON public.businesses, public.business_members, public.business_invitations,
  public.customers, public.items, public.invoices, public.invoice_items, public.transactions,
  public.invoice_status_history, public.audit_logs, public.chat_sessions, public.chat_messages,
  public.action_drafts, public.invoice_reminders, public.invoice_overview, public.customer_overview
TO authenticated;
GRANT INSERT, DELETE ON public.customers, public.items, public.chat_sessions TO authenticated;
GRANT UPDATE (name, contact_name, contact_email, phone, billing_address, tax_id, notes, is_active)
  ON public.customers TO authenticated;
GRANT UPDATE (name, description, unit, standard_price, default_tax_rate, default_discount_rate, is_active)
  ON public.items TO authenticated;
GRANT UPDATE (title) ON public.chat_sessions TO authenticated;
GRANT UPDATE (
  name, industry, team_size, country, currency, logo_url, logo_key, email, phone, address,
  timezone, invoice_prefix, payment_terms_days, default_tax_rate, invoice_language, default_notes,
  notify_invoice_due, notify_payment_received, notify_ai_action, notify_weekly_summary
) ON public.businesses TO authenticated;
GRANT UPDATE (display_name, role, status, last_active_at) ON public.business_members TO authenticated;

REVOKE ALL ON FUNCTION public.create_business(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_invoice_draft(UUID, UUID, DATE, JSONB, TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_invoice(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_invoice_sent(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_transaction(UUID, TEXT, TEXT, TEXT, NUMERIC, DATE, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_ai_action(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_ai_action(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.invite_business_member(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_business_invitation(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_dashboard_summary(UUID, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_ai_finance_context(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_business(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_invoice_draft(UUID, UUID, DATE, JSONB, TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_invoice(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_invoice_sent(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_transaction(UUID, TEXT, TEXT, TEXT, NUMERIC, DATE, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_ai_action(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_ai_action(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invite_business_member(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_business_invitation(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_summary(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ai_finance_context(UUID) TO authenticated;
