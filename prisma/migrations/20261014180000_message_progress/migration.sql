-- MSG-14: a message can carry one month of its sender's training, as
-- progress:YYYY-MM, on the same typed reference. Safe to run twice.
ALTER TYPE "MessageAttachmentKind" ADD VALUE IF NOT EXISTS 'PROGRESS';
