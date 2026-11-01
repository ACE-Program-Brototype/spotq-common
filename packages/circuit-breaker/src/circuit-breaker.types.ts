export enum CircuitBreakerState {
	CLOSED = "CLOSED",
	OPEN = "OPEN",
	HALF_OPEN = "HALF_OPEN",
}

export type FallbackFunction<
	TArgs extends unknown[] = unknown[],
	TReturn = unknown,
> =
	| ((...args: [...TArgs, error: unknown]) => TReturn | Promise<TReturn>)
	| ((error: unknown) => TReturn | Promise<TReturn>)
	| (() => TReturn | Promise<TReturn>);

export interface CircuitBreakerOptions<
	TArgs extends unknown[] = unknown[],
	TReturn = unknown,
> {
	name: string;
	timeoutMs?: number;
	errorThresholdPercentage?: number;
	resetTimeoutMs?: number;
	rollingWindowMs?: number;
	rollingWindowBuckets?: number;
	volumeThreshold?: number;
	isFailure?: (error: unknown) => boolean;
	fallback?: FallbackFunction<TArgs, TReturn>;
	onOpen?: () => void;
	onClose?: () => void;
	onHalfOpen?: () => void;
	onFallback?: (result: TReturn, error: unknown) => void;
}
