import { ERROR_NAMES, OPOSSUM_ERROR_CODES } from "./constants.js";

export class CircuitBreakerOpenError extends Error {
	public readonly code = OPOSSUM_ERROR_CODES.OPEN_BREAKER;
	public readonly breakerName: string | undefined;
	public readonly originalError: unknown | undefined;

	constructor(
		message: string,
		breakerName?: string | undefined,
		originalError?: unknown | undefined,
	) {
		super(
			message,
			originalError !== undefined ? { cause: originalError } : undefined,
		);
		this.name = ERROR_NAMES.OPEN;
		this.breakerName = breakerName;
		this.originalError = originalError;
	}
}

export class CircuitBreakerTimeoutError extends Error {
	public readonly code = OPOSSUM_ERROR_CODES.TIMED_OUT;
	public readonly breakerName: string | undefined;
	public readonly timeoutMs: number | undefined;
	public readonly originalError: unknown | undefined;

	constructor(
		message: string,
		breakerName?: string | undefined,
		timeoutMs?: number | undefined,
		originalError?: unknown | undefined,
	) {
		super(
			message,
			originalError !== undefined ? { cause: originalError } : undefined,
		);
		this.name = ERROR_NAMES.TIMEOUT;
		this.breakerName = breakerName;
		this.timeoutMs = timeoutMs;
		this.originalError = originalError;
	}
}
