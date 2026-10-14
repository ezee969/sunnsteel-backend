-- MSG-13: a message can carry one of its sender's comebacks, by its stable
-- recognition id, on the same typed reference. Safe to run twice.
ALTER TYPE "MessageAttachmentKind" ADD VALUE IF NOT EXISTS 'COMEBACK';
