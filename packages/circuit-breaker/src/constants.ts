export const DEFAULT_CIRCUIT_BREAKER_OPTIONS = {
	timeoutMs: 10000,
	resetTimeoutMs: 10000,
	errorThresholdPercentage: 50,
	volumeThreshold: 5,
	rollingWindowMs: 10000,
	rollingWindowBuckets: 10,
} as const;

export const CIRCUIT_BREAKER_EVENTS = {
	OPEN: "open",
	CLOSE: "close",
	HALF_OPEN: "halfOpen",
	FALLBACK: "fallback",
} as const;

export const OPOSSUM_ERROR_CODES = {
	OPEN_BREAKER: "EOPENBREAKER",
	TIMED_OUT: "ETIMEDOUT",
} as const;

export const ERROR_NAMES = {
	OPEN: "CircuitBreakerOpenError",
	TIMEOUT: "CircuitBreakerTimeoutError",
} as const;

export const ERROR_MESSAGES = {
	INVALID_ACTION: "Circuit breaker requires a valid action function",
	MISSING_NAME: "Circuit breaker requires a valid, non-empty 'name'",
	OPEN: (breakerName: string) =>
		`Circuit breaker '${breakerName}' is OPEN: fast-failing request`,
	TIMEOUT: (breakerName: string, timeoutMs: number) =>
		`Circuit breaker '${breakerName}' timed out after ${timeoutMs}ms`,
} as const;
