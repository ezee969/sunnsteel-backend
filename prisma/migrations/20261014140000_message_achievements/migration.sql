-- MSG-12: a message can carry one of its sender's earned milestones, by its
-- stable milestone id (`sessions:10`), on the same typed reference. Safe to
-- run twice.
ALTER TYPE "MessageAttachmentKind" ADD VALUE IF NOT EXISTS 'ACHIEVEMENT';
