/**
 * Cryptographic and token configuration defaults.
 */
export const CONFIG_DEFAULTS = {
	ALGORITHM: "RS256" as const,
	TOKEN_EXPIRATION: "15m" as const,
} as const;

/**
 * Standard HTTP status codes used in authentication.
 */
export const HTTP_STATUS = {
	UNAUTHORIZED: 401 as const,
} as const;

/**
 * Permitted machine-readable error codes for authentication failures.
 */
export const ERROR_CODES = {
	UNAUTHORIZED: "UNAUTHORIZED" as const,
	INVALID_TOKEN: "INVALID_TOKEN" as const,
} as const;

export type AuthErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * Standard HTTP headers used in service authentication.
 */
export const HEADERS = {
	AUTHORIZATION: "authorization",
	CALLER_SERVICE: "x-caller-service",
} as const;

/**
 * Issuer validation and runtime error messages.
 */
export const ISSUER_ERRORS = {
	CONFIG_REQUIRED: "Issuer Error: Configuration object is required.",
	PRIVATE_KEY_REQUIRED:
		"Issuer Error: Private key is required and cannot be empty.",
	SERVICE_NAME_REQUIRED:
		"Issuer Error: Service name is required and cannot be empty.",
	TARGET_AUDIENCE_REQUIRED:
		"Issuer Error: Target audience is required and cannot be empty.",
	UNKNOWN_SIGNING_ERROR: "Unknown cryptographic signing error",
	SIGNING_FAILED: (reason: string) =>
		`Issuer Error: Failed to sign token: ${reason}`,
} as const;

/**
 * Verifier initialization error messages.
 */
export const VERIFIER_ERRORS = {
	CONFIG_REQUIRED: "Verifier Error: Configuration object is required.",
	PUBLIC_KEY_REQUIRED:
		"Verifier Error: Public key is required and cannot be empty.",
	EXPECTED_AUDIENCE_REQUIRED:
		"Verifier Error: Expected audience is required and cannot be empty.",
} as const;

/**
 * Middleware authentication failure messages.
 */
export const AUTH_ERRORS = {
	MISSING_AUTH_HEADER: "Missing Authorization header.",
	MALFORMED_AUTH_HEADER:
		"Malformed Authorization header. Format must be 'Bearer <token>'.",
	MISSING_CALLER_HEADER: "Missing 'X-Caller-Service' header.",
	INVALID_PAYLOAD: "Invalid token payload.",
	UNKNOWN_VERIFICATION_ERROR: "Cryptographic verification failed.",
	TOKEN_VERIFICATION_FAILED: (reason: string) =>
		`Token verification failed: ${reason}`,
	CALLER_MISMATCH: (caller: string, identity: string) =>
		`Caller header '${caller}' does not match token identity '${identity}'.`,
} as const;
