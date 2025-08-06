#!/bin/bash

# Script para detectar cambios en la estructura del proyecto y recordar actualizar documentación

echo "🔍 Detecting project structure changes..."

# Backend - Detectar nuevos endpoints
echo "📡 Checking for new endpoints..."
NEW_ENDPOINTS=$(find src -name "*.controller.ts" -exec grep -l "@Post\|@Get\|@Put\|@Delete" {} \; 2>/dev/null)

# Detectar nuevos módulos
echo "📦 Checking for new modules..."
NEW_MODULES=$(find src -type d -maxdepth 1 -name "*" | grep -v "^src$" | sed 's|src/||')

# Detectar cambios en esquema de Prisma
echo "🗄️ Checking for Prisma schema changes..."
SCHEMA_CHANGES=$(git diff --name-only HEAD~1 | grep "prisma/schema.prisma" 2>/dev/null)

# Detectar nuevos DTOs
echo "📝 Checking for new DTOs..."
NEW_DTOS=$(find src -name "*.dto.ts" -type f 2>/dev/null)

# Detectar nuevos guards
echo "🛡️ Checking for new guards..."
NEW_GUARDS=$(find src -name "*guard*" -type f 2>/dev/null)

# Detectar cambios en package.json
echo "📦 Checking for package.json changes..."
PACKAGE_CHANGES=$(git diff --name-only HEAD~1 | grep "package.json" 2>/dev/null)

echo ""
echo "📋 SUMMARY OF DETECTED CHANGES:"
echo "================================"

if [ ! -z "$NEW_ENDPOINTS" ]; then
    echo "🆕 New endpoints detected:"
    echo "$NEW_ENDPOINTS"
    echo ""
fi

if [ ! -z "$NEW_MODULES" ]; then
    echo "🆕 New modules detected:"
    echo "$NEW_MODULES"
    echo ""
fi

if [ ! -z "$SCHEMA_CHANGES" ]; then
    echo "🔄 Prisma schema changes detected!"
    echo ""
fi

if [ ! -z "$NEW_DTOS" ]; then
    echo "🆕 New DTOs detected:"
    echo "$NEW_DTOS"
    echo ""
fi

if [ ! -z "$NEW_GUARDS" ]; then
    echo "🆕 New guards detected:"
    echo "$NEW_GUARDS"
    echo ""
fi

if [ ! -z "$PACKAGE_CHANGES" ]; then
    echo "📦 Package.json changes detected!"
    echo ""
fi

echo "⚠️  REMINDER: Update documentation files:"
echo "   - .cursor/rules/sunnsteel-backend.mdc"
echo "   - README.md"
echo ""
echo "💡 Run this script after making changes to detect what needs documentation updates." 