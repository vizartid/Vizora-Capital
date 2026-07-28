-- The notification queue is internal-only. Keep runtime roles explicitly denied
-- while giving the RLS advisor a concrete policy to audit.
CREATE POLICY large_expense_notifications_no_runtime_access
  ON public.large_expense_notifications
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (FALSE)
  WITH CHECK (FALSE);

REVOKE ALL ON TABLE public.large_expense_notifications FROM PUBLIC, anon, authenticated;

-- These helpers can respect caller RLS directly or delegate the only
-- recursion-sensitive lookup to is_business_member(). They do not require
-- owner privileges.
ALTER FUNCTION public.current_business_id() SECURITY INVOKER;
ALTER FUNCTION public.get_dashboard_summary(UUID, DATE) SECURITY INVOKER;
ALTER FUNCTION public.get_ai_finance_context(UUID) SECURITY INVOKER;
ALTER FUNCTION public.can_access_business_channel(TEXT) SECURITY INVOKER;

-- reject_ai_action is intentionally SECURITY DEFINER because action_drafts is
-- RPC-write-only. Make the authenticated identity check explicit so a NULL JWT
-- identity cannot pass a three-valued comparison against requested_by.
CREATE OR REPLACE FUNCTION public.reject_ai_action(p_action_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_action public.action_drafts;
  v_user_id UUID := (SELECT auth.uid());
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO v_action
  FROM public.action_drafts
  WHERE id = p_action_id
  FOR UPDATE;

  IF v_action.id IS NULL OR (
    v_action.requested_by <> v_user_id
    AND NOT public.has_business_role(v_action.business_id, ARRAY['administrator', 'approver'])
  ) THEN
    RAISE EXCEPTION 'Action not found or rejection not permitted';
  END IF;

  IF v_action.status <> 'pending' THEN
    RAISE EXCEPTION 'Action is not pending';
  END IF;

  UPDATE public.action_drafts
  SET status = 'rejected', rejected_by = v_user_id, rejected_at = NOW()
  WHERE id = p_action_id;

  RETURN jsonb_build_object('id', p_action_id, 'status', 'rejected');
END;
$$;

-- Remove PostgreSQL's default PUBLIC execute privilege, then grant only the
-- runtime role that needs these policy helpers and application RPCs.
REVOKE ALL ON FUNCTION public.is_business_member(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_business_role(UUID, TEXT[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.current_business_id() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_business(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_invoice_draft(UUID, UUID, DATE, JSONB, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.approve_invoice(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_invoice_sent(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_transaction(UUID, TEXT, TEXT, TEXT, NUMERIC, DATE, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.approve_ai_action(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_ai_action(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.invite_business_member(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accept_business_invitation(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_dashboard_summary(UUID, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_ai_finance_context(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_access_business_channel(TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.is_business_member(UUID),
  public.has_business_role(UUID, TEXT[]),
  public.current_business_id(),
  public.create_business(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT),
  public.create_invoice_draft(UUID, UUID, DATE, JSONB, TEXT, TEXT, UUID),
  public.approve_invoice(UUID),
  public.mark_invoice_sent(UUID, TEXT),
  public.record_transaction(UUID, TEXT, TEXT, TEXT, NUMERIC, DATE, UUID, TEXT),
  public.approve_ai_action(UUID),
  public.reject_ai_action(UUID),
  public.invite_business_member(UUID, TEXT, TEXT),
  public.accept_business_invitation(UUID, TEXT),
  public.get_dashboard_summary(UUID, DATE),
  public.get_ai_finance_context(UUID),
  public.can_access_business_channel(TEXT)
TO authenticated;

COMMENT ON FUNCTION public.is_business_member(UUID) IS
  'Audited SECURITY DEFINER RLS helper. Owner privileges are required to avoid recursive business_members RLS; the result is scoped to auth.uid().';
COMMENT ON FUNCTION public.has_business_role(UUID, TEXT[]) IS
  'Audited SECURITY DEFINER RLS helper. Owner privileges are required to avoid recursive business_members RLS; the result is scoped to auth.uid().';
COMMENT ON FUNCTION public.create_business(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) IS
  'Audited SECURITY DEFINER RPC. Requires auth.uid() and creates only a workspace owned by that caller.';
COMMENT ON FUNCTION public.create_invoice_draft(UUID, UUID, DATE, JSONB, TEXT, TEXT, UUID) IS
  'Audited SECURITY DEFINER RPC. Required for atomic invoice writes and guarded by tenant role checks.';
COMMENT ON FUNCTION public.approve_invoice(UUID) IS
  'Audited SECURITY DEFINER RPC. Required for an atomic status transition and guarded by tenant role checks.';
COMMENT ON FUNCTION public.mark_invoice_sent(UUID, TEXT) IS
  'Audited SECURITY DEFINER RPC. Required for an atomic status transition and guarded by tenant role checks.';
COMMENT ON FUNCTION public.record_transaction(UUID, TEXT, TEXT, TEXT, NUMERIC, DATE, UUID, TEXT) IS
  'Audited SECURITY DEFINER RPC. Required for atomic ledger and invoice updates and guarded by tenant role checks.';
COMMENT ON FUNCTION public.approve_ai_action(UUID) IS
  'Audited SECURITY DEFINER RPC. Required for an atomic approval workflow and guarded by tenant role checks.';
COMMENT ON FUNCTION public.reject_ai_action(UUID) IS
  'Audited SECURITY DEFINER RPC. Requires a non-NULL auth.uid() and caller ownership or an approving tenant role.';
COMMENT ON FUNCTION public.invite_business_member(UUID, TEXT, TEXT) IS
  'Audited SECURITY DEFINER RPC. Restricted to tenant administrators.';
COMMENT ON FUNCTION public.accept_business_invitation(UUID, TEXT) IS
  'Audited SECURITY DEFINER RPC. Requires auth.uid() and an unexpired invitation matching the JWT email.';

-- Foreign-key and RLS predicate indexes. InsForge migrations are transactional,
-- so these intentionally use regular CREATE INDEX rather than CONCURRENTLY.
CREATE INDEX idx_chat_messages_user_id
  ON public.chat_messages (user_id);
CREATE INDEX idx_action_drafts_rejected_by
  ON public.action_drafts (rejected_by);
CREATE INDEX idx_action_drafts_requested_by
  ON public.action_drafts (requested_by);
CREATE INDEX idx_action_drafts_session_id
  ON public.action_drafts (session_id);
CREATE INDEX idx_chat_messages_action_draft_id
  ON public.chat_messages (action_draft_id);
CREATE INDEX idx_chat_messages_business_id
  ON public.chat_messages (business_id);
CREATE INDEX idx_invoice_reminders_business_id
  ON public.invoice_reminders (business_id);
CREATE INDEX idx_large_expense_notifications_business_id
  ON public.large_expense_notifications (business_id);
CREATE INDEX idx_payment_orders_initiated_by
  ON public.payment_orders (initiated_by);
CREATE INDEX idx_business_subscriptions_latest_payment_order_id
  ON public.business_subscriptions (latest_payment_order_id);
CREATE INDEX idx_businesses_created_by
  ON public.businesses (created_by);
CREATE INDEX idx_business_invitations_business_id
  ON public.business_invitations (business_id);
CREATE INDEX idx_business_invitations_invited_by
  ON public.business_invitations (invited_by);
CREATE INDEX idx_customers_created_by
  ON public.customers (created_by);
CREATE INDEX idx_items_created_by
  ON public.items (created_by);
CREATE INDEX idx_invoices_ai_action_id
  ON public.invoices (ai_action_id);
CREATE INDEX idx_invoices_approved_by
  ON public.invoices (approved_by);
CREATE INDEX idx_invoices_created_by
  ON public.invoices (created_by);
CREATE INDEX idx_invoice_items_item_id
  ON public.invoice_items (item_id);
CREATE INDEX idx_transactions_created_by
  ON public.transactions (created_by);
CREATE INDEX idx_transactions_invoice_id
  ON public.transactions (invoice_id);
CREATE INDEX idx_invoice_status_history_business_id
  ON public.invoice_status_history (business_id);
CREATE INDEX idx_invoice_status_history_changed_by
  ON public.invoice_status_history (changed_by);
CREATE INDEX idx_audit_logs_actor_user_id
  ON public.audit_logs (actor_user_id);
CREATE INDEX idx_chat_sessions_business_id
  ON public.chat_sessions (business_id);
CREATE INDEX idx_action_drafts_approved_by
  ON public.action_drafts (approved_by);

-- The original partial index is subsumed by the full FK-supporting index above.
DROP INDEX public.transactions_invoice_idx;
