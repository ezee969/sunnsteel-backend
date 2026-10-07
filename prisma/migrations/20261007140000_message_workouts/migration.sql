-- MSG-10: a message can carry one of its sender's finished workouts, by the
-- same typed reference MSG-07 added for a routine. Safe to run twice.
ALTER TYPE "MessageAttachmentKind" ADD VALUE IF NOT EXISTS 'WORKOUT';
