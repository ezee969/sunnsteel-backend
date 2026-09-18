-- PROF-08: a shared routine becomes a fourth kind of featured profile item.
-- Nothing is backfilled: existing selections keep the kind they were saved
-- with, and a routine slot only exists once an owner chooses one.
ALTER TYPE "FeaturedProfileItemKind" ADD VALUE 'ROUTINE';
