/**
 * Cryptographic and token configuration defaults for S2S authentication.
 */
export const S2S_CONFIG_DEFAULTS = {
  ALGORITHM: 'RS256' as const,
  TOKEN_EXPIRATION: '15m' as const,
} as const;

/**
 * Standard HTTP status codes used in S2S authentication.
 */
export const S2S_HTTP_STATUS = {
  UNAUTHORIZED: 401 as const,
} as const;

/**
 * Permitted machine-readable error codes for S2S authentication failures.
 */
export const S2S_ERROR_CODES = {
  UNAUTHORIZED_S2S: 'UNAUTHORIZED_S2S' as const,
  INVALID_S2S_TOKEN: 'INVALID_S2S_TOKEN' as const,
} as const;

export type S2SErrorCode = (typeof S2S_ERROR_CODES)[keyof typeof S2S_ERROR_CODES];

/**
 * Standard HTTP headers used in S2S authentication.
 */
export const S2S_HEADERS = {
  AUTHORIZATION: 'authorization',
  CALLER_SERVICE: 'x-caller-service',
} as const;

/**
 * Issuer validation and runtime error messages.
 */
export const S2S_ISSUER_ERRORS = {
  CONFIG_REQUIRED: 'S2S Issuer Error: Configuration object is required.',
  PRIVATE_KEY_REQUIRED: 'S2S Issuer Error: Private key is required and cannot be empty.',
  SERVICE_NAME_REQUIRED: 'S2S Issuer Error: Service name is required and cannot be empty.',
  TARGET_AUDIENCE_REQUIRED: 'S2S Issuer Error: Target audience is required and cannot be empty.',
  UNKNOWN_SIGNING_ERROR: 'Unknown cryptographic signing error',
  SIGNING_FAILED: (reason: string) => `S2S Issuer Error: Failed to sign token: ${reason}`,
} as const;

/**
 * Verifier initialization error messages.
 */
export const S2S_VERIFIER_ERRORS = {
  CONFIG_REQUIRED: 'S2S Verifier Error: Configuration object is required.',
  PUBLIC_KEY_REQUIRED: 'S2S Verifier Error: Public key is required and cannot be empty.',
  EXPECTED_AUDIENCE_REQUIRED: 'S2S Verifier Error: Expected audience is required and cannot be empty.',
} as const;

/**
 * Middleware authentication failure messages.
 */
export const S2S_AUTH_ERRORS = {
  MISSING_AUTH_HEADER: 'Missing Authorization header.',
  MALFORMED_AUTH_HEADER: "Malformed Authorization header. Format must be 'Bearer <token>'.",
  MISSING_CALLER_HEADER: "Missing 'X-Caller-Service' header.",
  INVALID_PAYLOAD: 'Invalid S2S token payload.',
  UNKNOWN_VERIFICATION_ERROR: 'Cryptographic verification failed.',
  TOKEN_VERIFICATION_FAILED: (reason: string) => `Token verification failed: ${reason}`,
  CALLER_MISMATCH: (caller: string, identity: string) =>
    `Caller header '${caller}' does not match token identity '${identity}'.`,
} as const;
