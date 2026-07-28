CREATE TABLE public.large_expense_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'skipped', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processing_started_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  provider_message_id TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (transaction_id)
);

CREATE INDEX large_expense_notifications_pending_idx
  ON public.large_expense_notifications (next_attempt_at, created_at)
  WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.queue_large_expense_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.type = 'expense' AND NEW.amount > 10000000 THEN
    INSERT INTO public.large_expense_notifications (transaction_id, business_id)
    VALUES (NEW.id, NEW.business_id)
    ON CONFLICT (transaction_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER transactions_queue_large_expense_notification
  AFTER INSERT ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.queue_large_expense_notification();

CREATE TRIGGER large_expense_notifications_updated_at
  BEFORE UPDATE ON public.large_expense_notifications
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

CREATE OR REPLACE FUNCTION public.claim_large_expense_notifications(p_limit INTEGER DEFAULT 25)
RETURNS SETOF public.large_expense_notifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT notification.id
    FROM public.large_expense_notifications AS notification
    WHERE (
      notification.status = 'pending'
      AND notification.next_attempt_at <= NOW()
    ) OR (
      notification.status = 'processing'
      AND notification.processing_started_at < NOW() - INTERVAL '10 minutes'
    )
    ORDER BY notification.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100)
  )
  UPDATE public.large_expense_notifications AS notification
  SET status = 'processing',
      attempts = notification.attempts + 1,
      processing_started_at = NOW(),
      updated_at = NOW()
  FROM candidates
  WHERE notification.id = candidates.id
  RETURNING notification.*;
END;
$$;

ALTER TABLE public.large_expense_notifications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.large_expense_notifications FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.queue_large_expense_notification() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_large_expense_notifications(INTEGER) FROM PUBLIC, anon, authenticated;
