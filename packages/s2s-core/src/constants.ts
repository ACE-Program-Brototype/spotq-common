/**
 * Permitted asymmetric cryptographic signing and verification algorithms.
 * Symmetric (HMAC) algorithms (e.g., 'HS256') and 'none' are strictly forbidden.
 */
export const SUPPORTED_ASYMMETRIC_ALGORITHMS = [
	"RS256",
	"RS384",
	"RS512",
	"PS256",
	"PS384",
	"PS512",
	"ES256",
	"ES384",
	"ES512",
] as const;

export type SupportedAlgorithm =
	(typeof SUPPORTED_ASYMMETRIC_ALGORITHMS)[number];

export type AsymmetricAlgorithm = SupportedAlgorithm;

/**
 * Cryptographic and token configuration defaults.
 */
export const CONFIG_DEFAULTS = {
	ALGORITHM: "RS256" as SupportedAlgorithm,
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
 * Regular expressions used in authentication and token parsing.
 */
export const AUTH_PATTERNS = {
	/**
	 * Extracts Bearer tokens from the Authorization header.
	 * Tolerates flexible leading, trailing, and separating whitespace per RFC 6750.
	 */
	BEARER_TOKEN: /^\s*Bearer\s+(\S+)\s*$/i,
} as const;

export const BEARER_TOKEN_REGEX = AUTH_PATTERNS.BEARER_TOKEN;

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
	INVALID_ALGORITHM: (algorithm: string) =>
		`Issuer Error: Algorithm '${algorithm}' is not a supported asymmetric algorithm. Permitted algorithms: ${SUPPORTED_ASYMMETRIC_ALGORITHMS.join(", ")}.`,
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
	INVALID_ALGORITHM: (algorithm: string) =>
		`Verifier Error: Algorithm '${algorithm}' is not a supported asymmetric algorithm. Permitted algorithms: ${SUPPORTED_ASYMMETRIC_ALGORITHMS.join(", ")}.`,
	EMPTY_ALGORITHMS:
		"Verifier Error: Permitted algorithms list cannot be empty.",
} as const;

/**
 * Middleware authentication failure messages.
 */
export const AUTH_ERRORS = {
	MISSING_AUTH_HEADER: "Missing Authorization header.",
	MALFORMED_AUTH_HEADER:
		"Malformed Authorization header. Format must be 'Bearer <token>'.",
	MISSING_CALLER_HEADER: "Missing 'X-Caller-Service' header.",
	PUBLIC_KEY_NOT_FOUND: (caller: string) =>
		`No public key found for caller service '${caller}'.`,
	INVALID_PAYLOAD: "Invalid token payload.",
	UNKNOWN_VERIFICATION_ERROR: "Cryptographic verification failed.",
	TOKEN_VERIFICATION_FAILED: (reason: string) =>
		`Token verification failed: ${reason}`,
	CALLER_MISMATCH: (caller: string, identity: string) =>
		`Caller header '${caller}' does not match token identity '${identity}'.`,
} as const;
