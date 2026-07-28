CREATE TABLE public.payment_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  initiated_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  checkout_attempt_id UUID NOT NULL,
  midtrans_order_id TEXT NOT NULL UNIQUE CHECK (midtrans_order_id ~ '^Vizora-[0-9a-fA-F]{32}$'),
  midtrans_transaction_id TEXT,
  plan_id TEXT NOT NULL CHECK (plan_id IN ('starter', 'growth', 'scale')),
  billing_cycle TEXT NOT NULL CHECK (billing_cycle IN ('monthly', 'yearly')),
  amount BIGINT NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'IDR' CHECK (currency = 'IDR'),
  status TEXT NOT NULL DEFAULT 'creating'
    CHECK (status IN ('creating', 'pending', 'paid', 'failed', 'cancelled', 'expired', 'refunded')),
  transaction_status TEXT,
  fraud_status TEXT,
  status_code TEXT,
  payment_type TEXT,
  snap_token TEXT,
  redirect_url TEXT,
  create_error TEXT,
  paid_at TIMESTAMPTZ,
  fulfilled_at TIMESTAMPTZ,
  notification_received_at TIMESTAMPTZ,
  raw_notification JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, checkout_attempt_id)
);

CREATE TABLE public.business_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL UNIQUE REFERENCES public.businesses(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL CHECK (plan_id IN ('starter', 'growth', 'scale')),
  billing_cycle TEXT NOT NULL CHECK (billing_cycle IN ('monthly', 'yearly')),
  status TEXT NOT NULL CHECK (status IN ('active', 'past_due', 'cancelled')),
  provider TEXT NOT NULL DEFAULT 'midtrans' CHECK (provider = 'midtrans'),
  current_period_start TIMESTAMPTZ NOT NULL,
  current_period_end TIMESTAMPTZ NOT NULL,
  latest_payment_order_id UUID REFERENCES public.payment_orders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (current_period_end > current_period_start)
);

CREATE INDEX payment_orders_business_created_idx
  ON public.payment_orders (business_id, created_at DESC);
CREATE INDEX payment_orders_status_idx
  ON public.payment_orders (status, updated_at DESC);
CREATE INDEX business_subscriptions_period_idx
  ON public.business_subscriptions (status, current_period_end);

CREATE TRIGGER payment_orders_updated_at BEFORE UPDATE ON public.payment_orders
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();
CREATE TRIGGER business_subscriptions_updated_at BEFORE UPDATE ON public.business_subscriptions
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();
CREATE TRIGGER payment_orders_tenant_guard BEFORE UPDATE ON public.payment_orders
  FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_change();
CREATE TRIGGER business_subscriptions_tenant_guard BEFORE UPDATE ON public.business_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_tenant_change();

ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY payment_orders_select ON public.payment_orders FOR SELECT TO authenticated
  USING (public.has_business_role(business_id, ARRAY['administrator', 'finance']));
CREATE POLICY business_subscriptions_select ON public.business_subscriptions FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));

REVOKE ALL ON public.payment_orders, public.business_subscriptions FROM anon, authenticated;
GRANT SELECT ON public.payment_orders, public.business_subscriptions TO authenticated;
