-- MSG-11: a message can carry one of its sender's personal records, by its
-- PERSONAL_RECORD training event, on the same typed reference. Safe to run
-- twice.
ALTER TYPE "MessageAttachmentKind" ADD VALUE IF NOT EXISTS 'RECORD';
