# Sunnsteel Backend - Fitness API

Este es el proyecto backend para Sunnsteel, una API de fitness y entrenamiento.

## Stack Tecnológico

- **Framework**: NestJS (Node.js/TypeScript)
- **Base de datos**: PostgreSQL con Prisma ORM
- **Autenticación**: JWT con Passport.js
- **Validación**: class-validator y class-transformer
- **Seguridad**: bcrypt para hash de contraseñas, throttling con @nestjs/throttler
- **Puerto de desarrollo**: 4000 (configurable via PORT env var)

## Estructura del Proyecto

### Módulos Principales

- **AuthModule**: Manejo de autenticación (registro, login, logout, refresh tokens)
- **UsersModule**: Gestión de usuarios y perfiles
- **TokenModule**: Servicios de JWT y refresh tokens
- **DatabaseModule**: Configuración de Prisma y conexión a PostgreSQL
- **ConfigsModule**: Configuraciones del sistema

### Endpoints Disponibles

- **POST /api/auth/register**: Registro de usuarios
- **POST /api/auth/login**: Inicio de sesión
- **POST /api/auth/logout**: Cierre de sesión
- **POST /api/auth/refresh**: Renovación de tokens
- **GET /api/users/profile**: Obtener perfil de usuario (protegido)

### Base de Datos

- **User**: Usuarios con email, password, name
- **RefreshToken**: Tokens de renovación vinculados a usuarios
- **BlacklistedToken**: Tokens de acceso invalidados

## Configuración

### Variables de Entorno Requeridas

- `DATABASE_URL`: URL de conexión a PostgreSQL
- `JWT_SECRET`: Clave secreta para JWT
- `FRONTEND_URL`: URL del frontend (default: http://localhost:3000)
- `PORT`: Puerto del servidor (default: 4000)

### Características de Seguridad

- CORS configurado para el frontend
- Rate limiting global (100 requests por minuto)
- Validación de DTOs con pipes globales
- Cookies seguras para refresh tokens
- Blacklisting de tokens en logout

## Patrones de Desarrollo

### Autenticación y Autorización

- **JWT Strategy**: Passport JWT para validación de tokens
- **Local Strategy**: Passport Local para login con email/password
- **Guards**: 
  - `passport-jwt.guard.ts`: Guard para validación JWT
  - `passport-local.guard.ts`: Guard para autenticación local
- **Token Management**: Access tokens + refresh tokens
- **Auto-refresh**: Renovación automática de tokens

### Base de Datos

- **Prisma ORM**: Para operaciones de base de datos
- **Migrations**: Control de versiones de esquema
- **Relations**: Relaciones entre User y RefreshToken
- **Transactions**: Para operaciones complejas
- **Indexing**: Optimización de consultas

### API Design

- **RESTful**: Convenciones REST para endpoints
- **DTOs**: Data Transfer Objects para validación
  - `auth.dto.ts`: DTOs para autenticación (login, register)
  - `refresh-token.dto.ts`: DTOs para renovación de tokens
- **Pipes**: Validación global con class-validator
- **Interceptors**: Transformación de respuestas
- **Exception Filters**: Manejo centralizado de errores

### Seguridad

- **Password Hashing**: bcrypt para contraseñas
- **Rate Limiting**: Throttler para prevenir abuso
- **CORS**: Configuración específica para frontend
- **Token Blacklisting**: Invalidación de tokens
- **Input Validation**: Validación robusta de datos

## Integración con Frontend

### CORS Configuration

- Origin: http://localhost:3000 (frontend)
- Credentials: true (para cookies)
- Methods: GET, POST, PUT, DELETE, PATCH

### Authentication Flow

1. Register/Login → Access token en response
2. Refresh token en cookies (httpOnly, secure)
3. Auto-refresh cuando access token expira
4. Logout → Blacklist tokens y clear cookies

### Response Format

```typescript
{
  user: { id, email, name },
  accessToken: string
}
```

## Patrones de Código

### Imports y Estructura

- **Services**: Lógica de negocio
- **Controllers**: Manejo de requests/responses
- **DTOs**: Validación de datos
- **Guards**: Protección de rutas
- **Interceptors**: Transformación de datos

### Convenciones

- **Services**: camelCase con sufijo "Service"
- **Controllers**: PascalCase con sufijo "Controller"
- **DTOs**: PascalCase con sufijo "Dto"
- **Guards**: PascalCase con sufijo "Guard"
- **Types**: PascalCase con sufijo "Type"

### Manejo de Errores

- **HTTP Exceptions**: NestJS built-in exceptions
- **Custom Exceptions**: Para errores específicos del dominio
- **Exception Filters**: Manejo centralizado
- **Logging**: Para debugging y monitoreo

## Contexto para el Agente

Cuando implementes funcionalidades:

- Usa decoradores de NestJS (@Controller, @Service, @Injectable)
- Implementa autenticación con JWT y Passport
- Sigue patrones de Prisma para base de datos
- Valida datos con DTOs y class-validator
- Maneja errores de forma consistente
- Implementa seguridad con guards e interceptors
- Usa TypeScript con tipos estrictos
- Sigue convenciones REST para APIs
- Integra con el frontend de forma segura
  description:
  globs:
  alwaysApply: false

---
