#!/bin/bash

# Script Semi-Automático para Actualización de Documentación
# Detecta cambios, sugiere actualizaciones y pide confirmación

set -e

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Función para imprimir con colores
print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_header() {
    echo -e "${PURPLE}$1${NC}"
}

# Función para preguntar confirmación
ask_confirmation() {
    local message="$1"
    echo -e "${CYAN}🤔 $message (y/N)${NC}"
    read -r response
    if [[ "$response" =~ ^[Yy]$ ]]; then
        return 0
    else
        return 1
    fi
}

# Función para detectar cambios en backend
detect_backend_changes() {
    print_header "🔍 Detecting Backend Changes..."
    
    cd backend
    
    # Detectar nuevos endpoints
    NEW_ENDPOINTS=$(find src -name "*.controller.ts" -exec grep -l "@Post\|@Get\|@Put\|@Delete" {} \; 2>/dev/null | head -10)
    
    # Detectar nuevos módulos
    NEW_MODULES=$(find src -type d -maxdepth 1 -name "*" | grep -v "^src$" | sed 's|src/||' | head -10)
    
    # Detectar nuevos DTOs
    NEW_DTOS=$(find src -name "*.dto.ts" -type f 2>/dev/null | head -10)
    
    # Detectar nuevos guards
    NEW_GUARDS=$(find src -name "*guard*" -type f 2>/dev/null | head -10)
    
    # Detectar cambios en esquema Prisma
    SCHEMA_CHANGES=$(git diff --name-only HEAD~1 2>/dev/null | grep "prisma/schema.prisma" || echo "")
    
    cd ..
    
    # Guardar resultados
    BACKEND_CHANGES=""
    if [ ! -z "$NEW_ENDPOINTS" ]; then
        BACKEND_CHANGES="$BACKEND_CHANGES\n🆕 New endpoints: $NEW_ENDPOINTS"
    fi
    if [ ! -z "$NEW_MODULES" ]; then
        BACKEND_CHANGES="$BACKEND_CHANGES\n🆕 New modules: $NEW_MODULES"
    fi
    if [ ! -z "$NEW_DTOS" ]; then
        BACKEND_CHANGES="$BACKEND_CHANGES\n🆕 New DTOs: $NEW_DTOS"
    fi
    if [ ! -z "$NEW_GUARDS" ]; then
        BACKEND_CHANGES="$BACKEND_CHANGES\n🆕 New guards: $NEW_GUARDS"
    fi
    if [ ! -z "$SCHEMA_CHANGES" ]; then
        BACKEND_CHANGES="$BACKEND_CHANGES\n🔄 Prisma schema changes detected"
    fi
}

# Función para detectar cambios en frontend
detect_frontend_changes() {
    print_header "🔍 Detecting Frontend Changes..."
    
    cd frontend
    
    # Detectar nuevas páginas
    NEW_PAGES=$(find app -name "page.tsx" -type f 2>/dev/null | head -10)
    
    # Detectar nuevos componentes
    NEW_COMPONENTS=$(find components -name "*.tsx" -type f 2>/dev/null | head -10)
    
    # Detectar nuevos hooks
    NEW_HOOKS=$(find hooks -name "*.ts" -type f 2>/dev/null | head -10)
    
    # Detectar nuevos servicios
    NEW_SERVICES=$(find lib/api -name "*.ts" -type f 2>/dev/null | head -10)
    
    # Detectar nuevos schemas
    NEW_SCHEMAS=$(find schema -name "*.ts" -type f 2>/dev/null | head -10)
    
    # Detectar nuevos providers
    NEW_PROVIDERS=$(find providers -name "*.tsx" -type f 2>/dev/null | head -10)
    
    cd ..
    
    # Guardar resultados
    FRONTEND_CHANGES=""
    if [ ! -z "$NEW_PAGES" ]; then
        FRONTEND_CHANGES="$FRONTEND_CHANGES\n🆕 New pages: $NEW_PAGES"
    fi
    if [ ! -z "$NEW_COMPONENTS" ]; then
        FRONTEND_CHANGES="$FRONTEND_CHANGES\n🆕 New components: $NEW_COMPONENTS"
    fi
    if [ ! -z "$NEW_HOOKS" ]; then
        FRONTEND_CHANGES="$FRONTEND_CHANGES\n🆕 New hooks: $NEW_HOOKS"
    fi
    if [ ! -z "$NEW_SERVICES" ]; then
        FRONTEND_CHANGES="$FRONTEND_CHANGES\n🆕 New services: $NEW_SERVICES"
    fi
    if [ ! -z "$NEW_SCHEMAS" ]; then
        FRONTEND_CHANGES="$FRONTEND_CHANGES\n🆕 New schemas: $NEW_SCHEMAS"
    fi
    if [ ! -z "$NEW_PROVIDERS" ]; then
        FRONTEND_CHANGES="$FRONTEND_CHANGES\n🆕 New providers: $NEW_PROVIDERS"
    fi
}

# Función para sugerir actualizaciones de backend
suggest_backend_updates() {
    if [ ! -z "$BACKEND_CHANGES" ]; then
        print_header "📝 Backend Documentation Updates Needed:"
        echo -e "$BACKEND_CHANGES"
        echo ""
        
        # Sugerir actualizaciones específicas
        if [[ "$BACKEND_CHANGES" == *"New endpoints"* ]]; then
            print_warning "Suggestion: Update endpoints list in sunnsteel-backend.mdc"
        fi
        if [[ "$BACKEND_CHANGES" == *"New modules"* ]]; then
            print_warning "Suggestion: Update modules list in sunnsteel-backend.mdc"
        fi
        if [[ "$BACKEND_CHANGES" == *"New DTOs"* ]]; then
            print_warning "Suggestion: Update DTOs documentation in sunnsteel-backend.mdc"
        fi
        if [[ "$BACKEND_CHANGES" == *"Prisma schema"* ]]; then
            print_warning "Suggestion: Update database schema documentation in README.md"
        fi
        
        echo ""
        if ask_confirmation "Do you want to update backend documentation files?"; then
            update_backend_docs
        fi
    fi
}

# Función para sugerir actualizaciones de frontend
suggest_frontend_updates() {
    if [ ! -z "$FRONTEND_CHANGES" ]; then
        print_header "📝 Frontend Documentation Updates Needed:"
        echo -e "$FRONTEND_CHANGES"
        echo ""
        
        # Sugerir actualizaciones específicas
        if [[ "$FRONTEND_CHANGES" == *"New pages"* ]]; then
            print_warning "Suggestion: Update pages list in sunnsteel-project.mdc"
        fi
        if [[ "$FRONTEND_CHANGES" == *"New components"* ]]; then
            print_warning "Suggestion: Update components list in sunnsteel-project.mdc"
        fi
        if [[ "$FRONTEND_CHANGES" == *"New hooks"* ]]; then
            print_warning "Suggestion: Update hooks documentation in sunnsteel-project.mdc"
        fi
        if [[ "$FRONTEND_CHANGES" == *"New services"* ]]; then
            print_warning "Suggestion: Update API services documentation in sunnsteel-project.mdc"
        fi
        
        echo ""
        if ask_confirmation "Do you want to update frontend documentation files?"; then
            update_frontend_docs
        fi
    fi
}

# Función para actualizar documentación de backend
update_backend_docs() {
    print_header "🔄 Updating Backend Documentation..."
    
    cd backend
    
    # Crear backup de archivos actuales
    if [ -f ".cursor/rules/sunnsteel-backend.mdc" ]; then
        cp ".cursor/rules/sunnsteel-backend.mdc" ".cursor/rules/sunnsteel-backend.mdc.backup"
        print_success "Backup created: .cursor/rules/sunnsteel-backend.mdc.backup"
    fi
    
    # Aquí podrías agregar lógica para actualizar automáticamente
    # Por ahora, solo notificamos
    print_info "Please manually update the following files:"
    echo "  - .cursor/rules/sunnsteel-backend.mdc"
    echo "  - README.md"
    
    cd ..
}

# Función para actualizar documentación de frontend
update_frontend_docs() {
    print_header "🔄 Updating Frontend Documentation..."
    
    cd frontend
    
    # Crear backup de archivos actuales
    if [ -f ".cursor/rules/sunnsteel-project.mdc" ]; then
        cp ".cursor/rules/sunnsteel-project.mdc" ".cursor/rules/sunnsteel-project.mdc.backup"
        print_success "Backup created: .cursor/rules/sunnsteel-project.mdc.backup"
    fi
    
    # Aquí podrías agregar lógica para actualizar automáticamente
    # Por ahora, solo notificamos
    print_info "Please manually update the following files:"
    echo "  - .cursor/rules/sunnsteel-project.mdc"
    echo "  - README.md"
    
    cd ..
}

# Función principal
main() {
    print_header "🚀 Sunnsteel Semi-Automated Documentation Update"
    echo "======================================================"
    echo ""
    
    # Verificar que estamos en el directorio correcto
    if [ ! -d "backend" ] || [ ! -d "frontend" ]; then
        print_error "This script must be run from the sunnsteel workspace root"
        exit 1
    fi
    
    # Detectar cambios
    detect_backend_changes
    detect_frontend_changes
    
    # Mostrar resumen
    print_header "📋 Summary of Detected Changes:"
    echo "====================================="
    
    if [ -z "$BACKEND_CHANGES" ] && [ -z "$FRONTEND_CHANGES" ]; then
        print_success "No significant changes detected. Documentation is up to date!"
        exit 0
    fi
    
    # Sugerir actualizaciones
    suggest_backend_updates
    suggest_frontend_updates
    
    echo ""
    print_header "🎯 Next Steps:"
    echo "================"
    print_info "1. Review the suggested changes above"
    print_info "2. Update the documentation files manually"
    print_info "3. Run this script again to verify everything is up to date"
    print_info "4. Commit your documentation changes"
    
    echo ""
    print_success "Semi-automated documentation update completed!"
}

# Ejecutar función principal
main "$@" 