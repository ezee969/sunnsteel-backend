-- Migration: add programRtfSnapshot column for RtF schedule snapshotting (RTF-B09)
ALTER TABLE "Routine" ADD COLUMN "programRtfSnapshot" JSONB;
