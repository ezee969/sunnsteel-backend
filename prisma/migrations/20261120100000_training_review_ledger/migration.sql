-- INTEL-04: a training review the model answered with "not enough evidence"
-- has its own ledger status. Like every answer, it counts against the
-- member's month (`countsAgainstMonth`). Safe to run twice.
ALTER TYPE "AiUsageStatus" ADD VALUE IF NOT EXISTS 'NOT_ENOUGH';
