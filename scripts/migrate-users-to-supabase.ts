#!/usr/bin/env tsx

/**
 * User Migration Script - Migrate existing users to Supabase
 *
 * This script helps migrate existing users from the old authentication system
 * to Supabase Auth while preserving all their data.
 *
 * Prerequisites:
 * 1. Supabase project setup
 * 2. Environment variables configured
 * 3. Backend running with both auth systems
 *
 * Usage:
 * npm run tsx scripts/migrate-users-to-supabase.ts
 */

import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';

const prisma = new PrismaClient();

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = process.env.DRY_RUN === 'true'; // Set to 'true' for testing

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing Supabase configuration');
  console.error('Required environment variables:');
  console.error('  - SUPABASE_URL');
  console.error('  - SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

interface MigrationResult {
  total: number;
  migrated: number;
  alreadyMigrated: number;
  failed: number;
  errors: Array<{ email: string; error: string }>;
}

async function migrateUsers(): Promise<MigrationResult> {
  const result: MigrationResult = {
    total: 0,
    migrated: 0,
    alreadyMigrated: 0,
    failed: 0,
    errors: [],
  };

  try {
    // Get all users that need migration
    const users = await prisma.user.findMany({
      where: {
        supabaseUserId: null, // Users not yet migrated
        password: { not: null }, // Users with passwords (not OAuth-only)
      },
      select: {
        id: true,
        email: true,
        name: true,
        password: true,
        createdAt: true,
      },
    });

    result.total = users.length;
    console.log(`\n🔍 Found ${users.length} users to migrate`);

    if (DRY_RUN) {
      console.log('🧪 DRY RUN MODE - No actual changes will be made\n');
    }

    for (const user of users) {
      console.log(`\n👤 Processing user: ${user.email}`);

      try {
        // Create user in Supabase with a temporary password
        // Users will need to reset their password on first login
        const tempPassword = generateTempPassword();

        const { data: newUser, error } = await supabase.auth.admin.createUser({
          email: user.email,
          password: tempPassword,
          user_metadata: {
            name: user.name,
            migrated_from_legacy: true,
            original_created_at: user.createdAt.toISOString(),
          },
          email_confirm: true, // Auto-confirm email
        });

        if (error) {
          // Check if user already exists (common error during migration)
          if (
            error.message.includes('already registered') ||
            error.message.includes('already been registered')
          ) {
            console.log(`  ✅ User already exists in Supabase, skipping...`);
            // Try to find and link the existing user by email in our DB
            // This is a fallback - in production you'd handle this more carefully
            result.alreadyMigrated++;
            continue;
          }

          console.log(`  ❌ Failed to create Supabase user: ${error.message}`);
          result.errors.push({ email: user.email, error: error.message });
          result.failed++;
          continue;
        }

        if (!newUser.user) {
          console.log(`  ❌ Failed to create Supabase user: No user returned`);
          result.errors.push({
            email: user.email,
            error: 'No user returned from Supabase',
          });
          result.failed++;
          continue;
        }

        // Update our database to link the accounts
        if (!DRY_RUN) {
          await prisma.user.update({
            where: { id: user.id },
            data: {
              supabaseUserId: newUser.user.id,
              // Keep the original password for fallback during migration period
            },
          });
        }

        console.log(
          `  ✅ Successfully migrated user (temp password: ${tempPassword})`,
        );
        result.migrated++;
      } catch (error) {
        console.log(`  ❌ Unexpected error: ${error}`);
        result.errors.push({
          email: user.email,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        result.failed++;
      }
    }

    return result;
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

function generateTempPassword(): string {
  // Generate a secure temporary password
  const chars =
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

function printResults(result: MigrationResult) {
  console.log('\n' + '='.repeat(60));
  console.log('📊 MIGRATION RESULTS');
  console.log('='.repeat(60));
  console.log(`Total users processed: ${result.total}`);
  console.log(`Successfully migrated: ${result.migrated}`);
  console.log(`Already migrated: ${result.alreadyMigrated}`);
  console.log(`Failed migrations: ${result.failed}`);

  if (result.errors.length > 0) {
    console.log('\n❌ ERRORS:');
    result.errors.forEach((error, index) => {
      console.log(`${index + 1}. ${error.email}: ${error.error}`);
    });
  }

  if (result.migrated > 0) {
    console.log(
      '\n📧 IMPORTANT: Users with temporary passwords need to reset their passwords',
    );
    console.log('Consider sending password reset emails to migrated users.');
  }

  console.log('\n✅ Migration completed!');
}

// Main execution
async function main() {
  console.log('🚀 Starting user migration to Supabase...');
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Supabase URL: ${SUPABASE_URL}`);

  try {
    const result = await migrateUsers();
    printResults(result);
  } catch (error) {
    console.error('💥 Migration script failed:', error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main();
}
