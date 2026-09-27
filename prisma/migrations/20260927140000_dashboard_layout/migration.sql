-- DASH-05 / PREF-03: the dashboard order and hidden sections. Null is the
-- default layout, so nothing is backfilled.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "dashboardLayout" JSONB;
