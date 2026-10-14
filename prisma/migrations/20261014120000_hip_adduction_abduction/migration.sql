-- Movement patterns for the adductor and abductor machines: hip adduction and
-- hip abduction, between hip extension and plantar flexion. Safe to run twice.
ALTER TYPE "MovementPattern" ADD VALUE IF NOT EXISTS 'HIP_ADDUCTION' BEFORE 'PLANTAR_FLEXION';
ALTER TYPE "MovementPattern" ADD VALUE IF NOT EXISTS 'HIP_ABDUCTION' BEFORE 'PLANTAR_FLEXION';
