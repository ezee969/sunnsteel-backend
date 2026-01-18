# 2026-01-18 — Create Routine DTO constant typing fix

## Summary

- Replaced unsafe array spreads for enum validation in `CreateRoutineDto` and nested DTOs with typed readonly constants.
- Ensures `@IsIn` validators use strongly typed value lists, avoiding error-typed spreads flagged by ESLint.

## Rationale

- Spreading `REP_TYPES`/`PROGRAM_STYLES` directly triggered "unsafe spread of an error typed value" lint due to inferred `any`/error typing.
- Typed constants preserve the literal union types exported by contracts while satisfying validator expectations and keeping runtime behavior unchanged.

## Affected Areas

- Routine creation DTOs (`create-routine.dto.ts`): rep type and program style validators now reference `REP_TYPE_VALUES` and `PROGRAM_STYLE_VALUES`.

## Implementation Notes

- Introduced `REP_TYPE_VALUES` and `PROGRAM_STYLE_VALUES` as `readonly` arrays cast to their respective union types for safe reuse in `@IsIn` validators.

## Testing

- Lint warning eliminated locally after the change; functional behavior unchanged (validators still enforce the same allowed values).
