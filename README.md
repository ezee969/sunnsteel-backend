<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://coveralls.io/github/nestjs/nest?branch=master" target="_blank"><img src="https://coveralls.io/repos/github/nestjs/nest/badge.svg?branch=master#9" alt="Coverage" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

### Register Flow:

```mermaid
sequenceDiagram
  participant Client
  participant AuthController
  participant AuthService
  participant UsersService
  participant TokenService
  participant Database

  Client->>AuthController: POST /auth/register (RegisterDto)
  Note right of AuthController: RegisterDto includes email, password, and name
  AuthController->>AuthService: register(RegisterDto)
  Note right of AuthService: Validates email, password (min 6 chars), and name
  AuthService->>UsersService: findByEmail(email)
  UsersService-->>AuthService: User found? (Yes/No)
  alt Email already registered
    AuthService-->>AuthController: ConflictException
    AuthController-->>Client: 409 Conflict (Email already registered)
  else
    AuthService->>UsersService: create({ email, password, name })
    UsersService->>Database: Insert user (with hashed password)
    Database-->>UsersService: New user data (without password)
    UsersService-->>AuthService: Created user (email, name, id)
    AuthService->>TokenService: generateTokens(userId, email)
    TokenService->>Database: Store refresh token
    TokenService-->>AuthService: Access & Refresh tokens
    AuthService-->>AuthController: { user, tokens }
    AuthController->>Client: 201 Created (user, accessToken)
  end
```

### Diagram Explanation:

1. **Client to AuthController**: The client sends a `POST` request to `/auth/register` with the registration data (`email`, `password`, and `name`).
2. **AuthController to AuthService**: The `AuthController` calls the `register()` method in `AuthService` with the registration data.
3. **AuthService to UsersService**: The `AuthService` checks if a user with the provided email already exists using `UsersService`'s `findByEmail()` method.
4. **User already exists or not**:
   - If the user already exists, the system returns a `409 Conflict` response.
   - If the user doesn't exist, the system proceeds to create a new user.
5. **User creation**: The `AuthService` calls `UsersService`'s `create()` method to create a new user in the database, with the password being hashed before storage.
6. **Token generation**: The `AuthService` calls `TokenService` to generate an `accessToken` and `refreshToken` for the newly created user.
7. **Refresh token stored**: The refresh token is stored in the database for future use (to handle token refresh operations).
8. **Response to Client**: The `AuthController` sets the `refreshToken` in the client's cookies and returns the `user` object (excluding the password) along with the `accessToken` to the client.

### Sign-In Flow:

```mermaid
sequenceDiagram
  participant Client
  participant AuthController
  participant AuthService
  participant UsersService
  participant TokenService
  participant Database

  Client->>AuthController: POST /auth/login (LoginDto)
  Note right of AuthController: LoginDto includes email, password
  AuthController->>AuthService: login(LoginDto)
  AuthService->>UsersService: findByEmailWithPassword(email)
  UsersService-->>AuthService: User found (with password)?
  alt User not found
    AuthService-->>AuthController: UnauthorizedException
    AuthController-->>Client: 401 Unauthorized (User not found)
  else
    AuthService->>TokenService: generateTokens(user.id, user.email)
    TokenService->>Database: Store refresh token
    TokenService-->>AuthService: Access & Refresh tokens
    AuthService-->>AuthController: { user, tokens }
    AuthController->>Client: 200 OK (user, accessToken)
    Note right of Client: Set refreshToken cookie & return user data with accessToken
  end
```

### Diagram Explanation:

1. **Client to AuthController**: The client sends a `POST` request to `/auth/login` with the login credentials (`email` and `password`).
2. **AuthController to AuthService**: The `AuthController` calls the `login()` method in `AuthService` with the login data.
3. **AuthService to UsersService**: The `AuthService` checks the database using `UsersService` to find the user by email and validate the password.
4. **User found or not**:
   - If the user is not found, the system returns a `401 Unauthorized` response.
   - If the user is found, the system proceeds to generate tokens.
5. **Token generation**: The `AuthService` calls `TokenService` to generate access and refresh tokens.
6. **Tokens stored**: The refresh token is stored in the database.
7. **Response to Client**: The `AuthController` returns the user data along with the access token to the client and sets the refresh token in a cookie.

```

```
