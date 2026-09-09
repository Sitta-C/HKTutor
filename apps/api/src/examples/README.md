# Auth example

This directory demonstrates a NestJS endpoint that uses the current authentication stack end to
end: Swagger documentation, JWT authentication, role-based authorization, and access to the
current authenticated user.

The example endpoint is:

```http
GET /api/examples/protected
Authorization: Bearer <access-token>
```

Only users with the `TUTOR` or `ADMIN` role may call it.

## Files

### `auth-example.controller.ts`

The controller declares the route and connects the security components:

```ts
@UseGuards(JwtAuthGuard, RolesGuard)
export class AuthExampleController {
  @Get('protected')
  @GetProtectedAuthExampleDoc()
  @Roles(Role.TUTOR, Role.ADMIN)
  getProtectedExample(@CurrentUser() user: AuthenticatedUser) {
    // user.id, user.email, user.role, and user.sessionId are available here.
  }
}
```

Guard order matters. NestJS runs the guards from left to right, so `JwtAuthGuard` must run first to
create `request.auth`. `RolesGuard` can then check `request.auth.role`.

The source position of `@Roles(...)` relative to `@UseGuards(...)` does not control guard order.
`@Roles` stores metadata; the order inside `@UseGuards(...)` controls execution.

The example applies `@UseGuards` at controller level, so every endpoint in this controller is
protected. Move it to an individual method when only that route needs protection.

### `auth-example.swagger.ts`

The `@GetProtectedAuthExampleDoc()` decorator keeps Swagger metadata separate from controller
logic:

- `ApiOperation` supplies the Swagger UI operation name.
- `ApiBearerAuth` declares the Bearer access-token requirement.
- `ApiOkResponse` documents the successful response.
- `ApiUnauthorizedResponse` documents `401 Unauthorized`.
- `ApiForbiddenResponse` documents `403 Forbidden`.

Swagger describes the API and provides a token field in its UI. `ApiBearerAuth` does not protect a
route; the route must still use `JwtAuthGuard`.

`JWT_BEARER_AUTH` must match the security-scheme name registered through
`DocumentBuilder.addBearerAuth(...)`. Otherwise, Swagger UI may not attach the token to requests.

### `auth-example.dto.ts`

The response type used by Swagger and TypeScript contains:

- `message`: confirmation that the request passed the guards
- `userId`: the current user's ID
- `email`: the email loaded from the database
- `role`: the current database-backed role checked by `RolesGuard`

`@ApiProperty` produces OpenAPI schema metadata. It does not perform runtime validation. Request
bodies need validation decorators such as those from `class-validator`.

### `auth-example.module.ts`

This module registers `AuthExampleController`. Its authentication dependencies come from the
global `AuthModule` loaded by `AppModule`, so it does not import `AuthModule` again.

### `test/unit/examples/auth-example.controller.spec.ts`

The tests cover behavior and the OpenAPI contract:

- the controller returns the current user correctly
- the endpoint allows `TUTOR` and `ADMIN`
- the Swagger operation declares Bearer security and `200`, `401`, and `403` responses

## Detailed request flow

```text
Client
  -> Authorization: Bearer <access-token>
  -> JwtAuthGuard
       1. Read the Bearer token from the Authorization header.
       2. Verify signature, issuer, audience, token type, and expiry.
       3. Read sub (user ID) and sid (session ID) from the payload.
       4. Confirm that AuthSession is active and unexpired.
       5. Confirm that User is verified and has an active account status.
       6. Build request.auth from current database data.
  -> RolesGuard
       1. Read the roles declared by @Roles(...).
       2. Read the role from request.auth.
       3. Allow the request when the current role matches an allowed role.
  -> @CurrentUser()
       1. Read request.auth from ExecutionContext.
       2. Pass AuthenticatedUser to the controller parameter.
  -> Controller handler
```

The access-token payload contains `sub`, `sid`, `role`, `type`, `jti`, and standard JWT claims.
Controllers must not decode it themselves. Use `@CurrentUser()` because it exposes identity that
has passed `JwtAuthGuard` and has been refreshed from current database state.

`AuthenticatedUser` has this shape:

```ts
interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
  sessionId: string;
}
```

Although the token contains a role claim, `JwtAuthGuard` treats the current role in `User` as
authoritative. An administrator's role or suspension change therefore takes effect without waiting
for the access token to expire.

## `401` and `403`

`401 Unauthorized` means the request could not be authenticated. Examples include:

- no Bearer token
- malformed, invalidly signed, or expired token
- a refresh token supplied where an access token is required
- a revoked or expired session
- a missing, deleted, suspended, or unverified user

`403 Forbidden` means authentication succeeded, but the current role is not allowed. For example,
a `STUDENT` receives 403 from an endpoint restricted to `TUTOR` and `ADMIN`.

## Authentication without a role restriction

Use `JwtAuthGuard` alone. `RolesGuard` also allows every authenticated role when no `@Roles`
metadata exists, but the clearest form is:

```ts
@Get('me')
@UseGuards(JwtAuthGuard)
getMe(@CurrentUser() user: AuthenticatedUser) {
  return user;
}
```

## Role-restricted endpoint

```ts
@Get('admin-only')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
getAdminOnly(@CurrentUser() user: AuthenticatedUser) {
  return { adminId: user.id };
}
```

When several controller routes share the same guards, apply `@UseGuards` at controller level and
put `@Roles` on the individual methods. A method without `@Roles` remains available to every
authenticated role.

## Testing through Swagger UI

1. Call `POST /api/auth/login` with a verified account.
2. Copy `accessToken` from the response. Do not use the refresh token.
3. Select **Authorize** in Swagger UI.
4. Enter the access token in the format requested by the UI.
5. Call `GET /api/examples/protected`.
6. A `TUTOR` or `ADMIN` should receive 200; a `STUDENT` should receive 403.

The refresh token is stored in the `hktutor_refresh` cookie and is used only by refresh/logout. Do
not place it in the Bearer header.
