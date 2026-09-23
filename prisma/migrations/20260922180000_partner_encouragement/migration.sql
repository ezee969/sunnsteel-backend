-- SOC-09: one of four fixed, permissioned training-partner prompts.
-- The Notification row is both the delivered item and the durable evidence
-- used for the rolling per-pair rate limit; no parallel message model exists.
ALTER TYPE "NotificationKind" ADD VALUE 'TRAINING_PARTNER_ENCOURAGEMENT';
