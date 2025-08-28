#!/bin/bash

set -euo pipefail
BASE=${1:-HEAD~1}

# Script para detectar cambios en la estructura del proyecto y recordar actualizar documentación

echo "🔍 Detecting project structure changes..."

# Backend - Detectar endpoints cambiados
echo "📡 Checking for changed endpoints since $BASE..."
CHANGED_CONTROLLERS=$(git diff --name-only "$BASE" -- 'src/**/*.controller.ts' 2>/dev/null || true)

# Detectar módulos cambiados
echo "📦 Checking for changed modules since $BASE..."
CHANGED_MODULES=$(git diff --name-only "$BASE" -- 'src/**/*.module.ts' 2>/dev/null || true)

# Detectar cambios en esquema de Prisma
echo "🗄️ Checking for Prisma schema changes since $BASE..."
SCHEMA_CHANGES=$(git diff --name-only "$BASE" -- prisma/schema.prisma 2>/dev/null || true)

# Detectar DTOs cambiados
echo "📝 Checking for changed DTOs since $BASE..."
CHANGED_DTOS=$(git diff --name-only "$BASE" -- 'src/**/*.dto.ts' 2>/dev/null || true)

# Detectar guards cambiados
echo "🛡️ Checking for changed guards since $BASE..."
CHANGED_GUARDS=$(git diff --name-only "$BASE" -- 'src/**/*guard*.ts' 2>/dev/null || true)

# Detectar cambios en package.json
echo "📦 Checking for package.json changes since $BASE..."
PACKAGE_CHANGES=$(git diff --name-only "$BASE" -- package.json 2>/dev/null || true)

echo ""
echo "📋 SUMMARY OF DETECTED CHANGES (vs $BASE):"
echo "================================"

if [ -n "$CHANGED_CONTROLLERS" ]; then
    echo "🆕 Controllers changed:"
    echo "$CHANGED_CONTROLLERS"
    echo ""
    echo "🔖 Endpoint decorators in changed controllers:"
    echo "$CHANGED_CONTROLLERS" | xargs -r -I {} sh -c "echo '• {}'; grep -nE '@(Get|Post|Put|Patch|Delete)' {} || true; echo ''"
fi

if [ -n "$CHANGED_MODULES" ]; then
    echo "🆕 Modules changed:"
    echo "$CHANGED_MODULES"
    echo ""
fi

if [ -n "$SCHEMA_CHANGES" ]; then
    echo "🔄 Prisma schema changes detected!"
    echo ""
fi

if [ -n "$CHANGED_DTOS" ]; then
    echo "🆕 DTOs changed:"
    echo "$CHANGED_DTOS"
    echo ""
fi

if [ -n "$CHANGED_GUARDS" ]; then
    echo "🆕 Guards changed:"
    echo "$CHANGED_GUARDS"
    echo ""
fi

if [ -n "$PACKAGE_CHANGES" ]; then
    echo "📦 Package.json changes detected!"
    echo ""
fi

echo "⚠️  REMINDER: Update documentation files:"
echo "   - .cursor/rules/sunnsteel-backend.mdc"
echo "   - README.md"
echo ""
echo "💡 Run this script after making changes to detect what needs documentation updates." 