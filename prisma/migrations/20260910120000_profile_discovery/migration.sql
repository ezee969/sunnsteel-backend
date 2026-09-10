ALTER TABLE "User"
ADD COLUMN "discoverableByName" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "discoverableByUsername" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "discoverableByContacts" BOOLEAN NOT NULL DEFAULT false;
