-- Estimates are derived from logged sets on read, so the only one-rep max stored is one the owner tested. A rename rather than drizzle's drop and recreate, which would fail its cast on any row already of the old kind.
ALTER TYPE "public"."measurement_kind" RENAME VALUE 'estimated_1rm' TO 'tested_1rm';
