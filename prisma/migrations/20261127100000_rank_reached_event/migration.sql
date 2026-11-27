-- ACH-12: a Renaissance rank reached is recorded once per account and rank, so
-- the rank shown never drops. Its own migration because a new enum value
-- cannot be used in the transaction that adds it. Safe to run twice.
ALTER TYPE "TrainingEventType" ADD VALUE IF NOT EXISTS 'RANK_REACHED';
