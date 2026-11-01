import { EventEmitter } from "node:events";
import OpossumBreaker from "opossum";
import {
	type CircuitBreakerOptions,
	CircuitBreakerState,
	type FallbackFunction,
} from "./circuit-breaker.types.js";
import {
	CIRCUIT_BREAKER_EVENTS,
	DEFAULT_CIRCUIT_BREAKER_OPTIONS,
	ERROR_MESSAGES,
	OPOSSUM_ERROR_CODES,
} from "./constants.js";
import {
	CircuitBreakerOpenError,
	CircuitBreakerTimeoutError,
} from "./errors.js";

type ActionFunction<TArgs extends unknown[], TReturn> = (
	...args: TArgs
) => Promise<TReturn> | TReturn;

export class CircuitBreaker<
	TArgs extends unknown[] = unknown[],
	TReturn = unknown,
> extends EventEmitter {
	public readonly name: string;
	private readonly action: ActionFunction<TArgs, TReturn>;
	private readonly options: CircuitBreakerOptions<TArgs, TReturn>;
	private readonly underlying: OpossumBreaker;
	private customFallback: FallbackFunction<TArgs, TReturn> | undefined;

	constructor(
		action: ActionFunction<TArgs, TReturn>,
		options: CircuitBreakerOptions<TArgs, TReturn>,
	) {
		super();
		this.action = action;
		this.options = options;
		this.name = options.name;

		const timeoutMs =
			options.timeoutMs ?? DEFAULT_CIRCUIT_BREAKER_OPTIONS.timeoutMs;
		const timeout = timeoutMs === 0 ? false : timeoutMs;

		const isFailure = options.isFailure;
		const errorFilter = isFailure
			? (err: unknown) => !isFailure(err)
			: undefined;

		this.underlying = new OpossumBreaker(
			async (...args: unknown[]) => {
				return await this.action(...(args as TArgs));
			},
			{
				name: this.name,
				timeout,
				resetTimeout:
					options.resetTimeoutMs ??
					DEFAULT_CIRCUIT_BREAKER_OPTIONS.resetTimeoutMs,
				errorThresholdPercentage:
					options.errorThresholdPercentage ??
					DEFAULT_CIRCUIT_BREAKER_OPTIONS.errorThresholdPercentage,
				volumeThreshold:
					options.volumeThreshold ??
					DEFAULT_CIRCUIT_BREAKER_OPTIONS.volumeThreshold,
				rollingCountTimeout:
					options.rollingWindowMs ??
					DEFAULT_CIRCUIT_BREAKER_OPTIONS.rollingWindowMs,
				rollingCountBuckets:
					options.rollingWindowBuckets ??
					DEFAULT_CIRCUIT_BREAKER_OPTIONS.rollingWindowBuckets,
				errorFilter,
			},
		);

		if (options.fallback) {
			this.fallback(options.fallback);
		}

		this.registerEventListeners();
	}

	private registerEventListeners(): void {
		this.underlying.on(CIRCUIT_BREAKER_EVENTS.OPEN, () => {
			this.options.onOpen?.();
			this.emit(CIRCUIT_BREAKER_EVENTS.OPEN);
		});

		this.underlying.on(CIRCUIT_BREAKER_EVENTS.CLOSE, () => {
			this.options.onClose?.();
			this.emit(CIRCUIT_BREAKER_EVENTS.CLOSE);
		});

		this.underlying.on(CIRCUIT_BREAKER_EVENTS.HALF_OPEN, () => {
			this.options.onHalfOpen?.();
			this.emit(CIRCUIT_BREAKER_EVENTS.HALF_OPEN);
		});

		this.underlying.on(
			CIRCUIT_BREAKER_EVENTS.FALLBACK,
			(result: unknown, err: Error) => {
				this.options.onFallback?.(result as TReturn, err);
				this.emit(CIRCUIT_BREAKER_EVENTS.FALLBACK, result, err);
			},
		);
	}

	public fallback(fn: FallbackFunction<TArgs, TReturn>): this {
		this.customFallback = fn;
		this.underlying.fallback((...args: unknown[]) => {
			return (this.customFallback as (...params: unknown[]) => unknown)(
				...args,
			);
		});
		return this;
	}

	public async execute(...args: TArgs): Promise<TReturn> {
		try {
			return (await this.underlying.fire(...args)) as TReturn;
		} catch (err: unknown) {
			const errorCode = (err as { code?: string })?.code;
			if (errorCode === OPOSSUM_ERROR_CODES.OPEN_BREAKER) {
				throw new CircuitBreakerOpenError(
					ERROR_MESSAGES.OPEN(this.name),
					this.name,
					err,
				);
			}
			if (errorCode === OPOSSUM_ERROR_CODES.TIMED_OUT) {
				const timeoutMs =
					this.options.timeoutMs ?? DEFAULT_CIRCUIT_BREAKER_OPTIONS.timeoutMs;
				throw new CircuitBreakerTimeoutError(
					ERROR_MESSAGES.TIMEOUT(this.name, timeoutMs),
					this.name,
					timeoutMs,
					err,
				);
			}
			throw err;
		}
	}

	public get state(): CircuitBreakerState {
		if (this.underlying.opened) {
			return CircuitBreakerState.OPEN;
		}
		if (this.underlying.halfOpen) {
			return CircuitBreakerState.HALF_OPEN;
		}
		return CircuitBreakerState.CLOSED;
	}

	public get isOpen(): boolean {
		return this.state === CircuitBreakerState.OPEN;
	}

	public get isClosed(): boolean {
		return this.state === CircuitBreakerState.CLOSED;
	}

	public get isHalfOpen(): boolean {
		return this.state === CircuitBreakerState.HALF_OPEN;
	}

	public open(): void {
		this.underlying.open();
	}

	public close(): void {
		this.underlying.close();
	}

	public shutdown(): void {
		this.underlying.shutdown();
	}
}
