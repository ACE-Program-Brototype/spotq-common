import { describe, expect, it, jest } from "@jest/globals";
import {
	CircuitBreaker,
	CircuitBreakerOpenError,
	CircuitBreakerState,
	CircuitBreakerTimeoutError,
} from "../src/index.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("CircuitBreaker", () => {
	describe("AC 1: Normal Operation (Closed State)", () => {
		it("should execute successfully and return the action result", async () => {
			const action = jest.fn(async (id: string) => ({
				id,
				name: "Pizza Palace",
			}));
			const breaker = new CircuitBreaker(action, {
				name: "test-normal",
				timeoutMs: 1000,
			});

			expect(breaker.state).toBe(CircuitBreakerState.CLOSED);
			expect(breaker.isClosed).toBe(true);
			expect(breaker.isOpen).toBe(false);
			expect(breaker.isHalfOpen).toBe(false);

			const result = await breaker.execute("rest_1");

			expect(result).toEqual({ id: "rest_1", name: "Pizza Palace" });
			expect(action).toHaveBeenCalledWith("rest_1");

			breaker.shutdown();
		});

		it("should throw TypeError if action is not a function", () => {
			expect(
				() =>
					new CircuitBreaker(null as unknown as () => Promise<string>, {
						name: "test",
					}),
			).toThrow(TypeError);
			expect(
				() =>
					new CircuitBreaker(undefined as unknown as () => Promise<string>, {
						name: "test",
					}),
			).toThrow("Circuit breaker requires a valid action function");
		});

		it("should throw error if name is missing or empty", () => {
			expect(
				() =>
					new CircuitBreaker(async () => "ok", {
						name: "",
					}),
			).toThrow("Circuit breaker requires a valid, non-empty 'name'");
			expect(
				() =>
					new CircuitBreaker(
						async () => "ok",
						{} as unknown as { name: string },
					),
			).toThrow("Circuit breaker requires a valid, non-empty 'name'");
		});
	});

	describe("AC 2: Trip to Open (Failure Threshold & Fast-Fail)", () => {
		it("should trip to OPEN when errorThresholdPercentage is reached and reject calls fast", async () => {
			const failingAction = jest.fn(async () => {
				throw new Error("Downstream service unavailable (500)");
			});

			const onOpen = jest.fn();

			const breaker = new CircuitBreaker(failingAction, {
				name: "test-trip-open",
				volumeThreshold: 2,
				errorThresholdPercentage: 50,
				resetTimeoutMs: 1000,
				onOpen,
			});

			// Request 1: fails
			await expect(breaker.execute()).rejects.toThrow(
				"Downstream service unavailable",
			);
			expect(breaker.isOpen).toBe(false);

			// Request 2: fails -> threshold reached (2 requests, 100% failure >= 50%) -> trips OPEN
			await expect(breaker.execute()).rejects.toThrow(
				"Downstream service unavailable",
			);
			expect(breaker.isOpen).toBe(true);
			expect(breaker.state).toBe(CircuitBreakerState.OPEN);
			expect(onOpen).toHaveBeenCalledTimes(1);

			// Request 3: Circuit is OPEN, must fail fast without calling downstream action
			const callCountBefore = failingAction.mock.calls.length;

			await expect(breaker.execute()).rejects.toThrow(CircuitBreakerOpenError);
			expect(failingAction.mock.calls.length).toBe(callCountBefore);

			breaker.shutdown();
		});

		it("should wrap open error in CircuitBreakerOpenError with breaker metadata", async () => {
			const breaker = new CircuitBreaker(async () => "ok", {
				name: "restaurant-service",
			});

			breaker.open();
			expect(breaker.isOpen).toBe(true);

			try {
				await breaker.execute();
				throw new Error("Should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(CircuitBreakerOpenError);
				expect((err as CircuitBreakerOpenError).breakerName).toBe(
					"restaurant-service",
				);
				expect((err as CircuitBreakerOpenError).code).toBe("EOPENBREAKER");
			}

			breaker.shutdown();
		});
	});

	describe("AC 3: Half-Open & Recovery", () => {
		it("should transition to HALF_OPEN after resetTimeoutMs and recover to CLOSED on successful probe", async () => {
			let fail = true;
			const onHalfOpen = jest.fn();
			const onClose = jest.fn();

			const breaker = new CircuitBreaker(
				async () => {
					if (fail) throw new Error("Connection failed");
					return "recovered";
				},
				{
					name: "test-recovery",
					volumeThreshold: 1,
					errorThresholdPercentage: 1,
					resetTimeoutMs: 80,
					onHalfOpen,
					onClose,
				},
			);

			// Trip breaker
			await expect(breaker.execute()).rejects.toThrow("Connection failed");
			expect(breaker.isOpen).toBe(true);

			// Wait for resetTimeoutMs
			await sleep(120);

			// Breaker is now ready for trial probe in HALF_OPEN
			expect(breaker.isHalfOpen).toBe(true);
			expect(breaker.state).toBe(CircuitBreakerState.HALF_OPEN);
			expect(onHalfOpen).toHaveBeenCalled();

			// Successful probe
			fail = false;
			const res = await breaker.execute();
			expect(res).toBe("recovered");

			// Breaker recovered to CLOSED
			expect(breaker.isClosed).toBe(true);
			expect(breaker.state).toBe(CircuitBreakerState.CLOSED);
			expect(onClose).toHaveBeenCalled();

			breaker.shutdown();
		});

		it("should re-open if probe in HALF_OPEN fails", async () => {
			const onOpen = jest.fn();

			const breaker = new CircuitBreaker(
				async () => {
					throw new Error("Persistent outage");
				},
				{
					name: "test-half-open-failure",
					volumeThreshold: 1,
					errorThresholdPercentage: 1,
					resetTimeoutMs: 80,
					onOpen,
				},
			);

			// Trip breaker
			await expect(breaker.execute()).rejects.toThrow("Persistent outage");
			expect(breaker.isOpen).toBe(true);
			expect(onOpen).toHaveBeenCalledTimes(1);

			// Wait for reset timeout
			await sleep(120);
			expect(breaker.isHalfOpen).toBe(true);

			// Probe fails
			await expect(breaker.execute()).rejects.toThrow("Persistent outage");

			// Must return back to OPEN
			expect(breaker.isOpen).toBe(true);
			expect(breaker.state).toBe(CircuitBreakerState.OPEN);
			expect(onOpen).toHaveBeenCalledTimes(2);

			breaker.shutdown();
		});
	});

	describe("AC 4: Error Filtering (checkIsFailure Predicate)", () => {
		interface HttpError extends Error {
			statusCode: number;
		}

		function createHttpError(statusCode: number, message: string): HttpError {
			const error = new Error(message) as HttpError;
			error.statusCode = statusCode;
			return error;
		}

		it("should not count filtered non-transient errors (e.g. 404, 400) towards circuit failure", async () => {
			const action = jest.fn(async (status: number) => {
				throw createHttpError(status, `HTTP error ${status}`);
			});

			const breaker = new CircuitBreaker(action, {
				name: "test-filter",
				volumeThreshold: 2,
				errorThresholdPercentage: 50,
				checkIsFailure: (err) => {
					// 4xx errors are client errors, not circuit breaker upstream outage failures
					if (typeof err === "object" && err !== null && "statusCode" in err) {
						return (err as { statusCode: number }).statusCode >= 500;
					}
					return true;
				},
			});

			// Execute 3 times with 404
			for (let i = 0; i < 3; i++) {
				await expect(breaker.execute(404)).rejects.toThrow("HTTP error 404");
			}

			// Circuit should remain CLOSED because 404 was excluded by checkIsFailure
			expect(breaker.isClosed).toBe(true);
			expect(breaker.isOpen).toBe(false);

			// Now execute with 500 (upstream outage)
			// Calling 500 four times results in 4 failures / 7 requests (~57% > 50%)
			for (let i = 0; i < 4; i++) {
				await expect(breaker.execute(500)).rejects.toThrow("HTTP error 500");
			}

			// Now it trips because 500 is considered a circuit failure and exceeds 50%
			expect(breaker.isOpen).toBe(true);

			breaker.shutdown();
		});

		it("should pass request arguments to checkIsFailure predicate", async () => {
			const action = jest.fn(
				async (endpoint: string, _payload: { id: string }) => {
					throw new Error(`Failed call to ${endpoint}`);
				},
			);

			const checkIsFailureMock = jest.fn(
				(_err: unknown, endpoint: string, payload: { id: string }) => {
					// Exclude errors for optional endpoints or specific payload IDs
					if (endpoint === "/optional-endpoint" || payload.id === "skip") {
						return false;
					}
					return true;
				},
			);

			const breaker = new CircuitBreaker(action, {
				name: "test-filter-args",
				volumeThreshold: 1,
				errorThresholdPercentage: 50,
				checkIsFailure: checkIsFailureMock,
			});

			await expect(
				breaker.execute("/optional-endpoint", { id: "skip" }),
			).rejects.toThrow("Failed call to /optional-endpoint");

			expect(checkIsFailureMock).toHaveBeenCalledTimes(1);
			expect(checkIsFailureMock).toHaveBeenCalledWith(
				expect.any(Error),
				"/optional-endpoint",
				{ id: "skip" },
			);
			// Circuit remains closed because checkIsFailure returned false using the args
			expect(breaker.isClosed).toBe(true);

			breaker.shutdown();
		});
	});

	describe("Fallback Support", () => {
		it("should invoke fallback when breaker is OPEN", async () => {
			const action = async (_id: string) => {
				throw new Error("Outage");
			};

			const onFallback = jest.fn();

			const breaker = new CircuitBreaker(action, {
				name: "test-fallback-open",
				volumeThreshold: 1,
				errorThresholdPercentage: 1,
				fallback: (id, _error) => ({
					id,
					name: "Fallback Store",
					cached: true,
				}),
				onFallback,
			});

			// Initial failure trips breaker and triggers fallback
			const res1 = await breaker.execute("rest_99");
			expect(res1).toEqual({
				id: "rest_99",
				name: "Fallback Store",
				cached: true,
			});
			expect(onFallback).toHaveBeenCalledTimes(1);
			expect(breaker.isOpen).toBe(true);

			// Subsequent call while OPEN also triggers fallback smoothly
			const res2 = await breaker.execute("rest_100");
			expect(res2).toEqual({
				id: "rest_100",
				name: "Fallback Store",
				cached: true,
			});
			expect(onFallback).toHaveBeenCalledTimes(2);

			breaker.shutdown();
		});

		it("should support registering fallback via .fallback() method", async () => {
			const breaker = new CircuitBreaker(
				async (): Promise<string> => {
					throw new Error("Immediate fail");
				},
				{
					name: "test-fallback-chain",
					volumeThreshold: 1,
				},
			);

			breaker.fallback((_err) => "chained-fallback-result");

			const res = await breaker.execute();
			expect(res).toBe("chained-fallback-result");

			breaker.shutdown();
		});

		it("should invoke fallback when operation times out", async () => {
			const slowAction = async () => {
				await sleep(80);
				return "too late";
			};

			const breaker = new CircuitBreaker(slowAction, {
				name: "test-fallback-timeout",
				timeoutMs: 25,
				fallback: () => "timed-out-fallback",
			});

			const res = await breaker.execute();
			expect(res).toBe("timed-out-fallback");

			breaker.shutdown();
		});
	});

	describe("Timeout Handling", () => {
		it("should throw CircuitBreakerTimeoutError when request times out without fallback", async () => {
			const slowAction = async () => {
				await sleep(100);
				return "done";
			};

			const breaker = new CircuitBreaker(slowAction, {
				name: "eta-service",
				timeoutMs: 25,
			});

			try {
				await breaker.execute();
				throw new Error("Expected timeout error");
			} catch (err) {
				expect(err).toBeInstanceOf(CircuitBreakerTimeoutError);
				expect((err as CircuitBreakerTimeoutError).breakerName).toBe(
					"eta-service",
				);
				expect((err as CircuitBreakerTimeoutError).timeoutMs).toBe(25);
			}

			breaker.shutdown();
		});
	});

	describe("Lifecycle Event Subscriptions", () => {
		it("should emit events for metrics and logging integration", async () => {
			const events: string[] = [];

			const breaker = new CircuitBreaker(
				async (val: string) => {
					if (val === "err") throw new Error("boom");
					return val;
				},
				{
					name: "test-events",
					volumeThreshold: 1,
					errorThresholdPercentage: 1,
					resetTimeoutMs: 50,
				},
			);

			breaker.on("open", () => events.push("open"));
			breaker.on("halfOpen", () => events.push("halfOpen"));
			breaker.on("close", () => events.push("close"));

			await breaker.execute("ok");

			events.length = 0;
			await expect(breaker.execute("err")).rejects.toThrow("boom");
			expect(events).toContain("open");

			await sleep(70);
			expect(events).toContain("halfOpen");

			await breaker.execute("ok");
			expect(events).toContain("close");

			breaker.shutdown();
		});
	});

	describe("Manual State and Breaker Controls", () => {
		it("should allow manual open and close", () => {
			const breaker = new CircuitBreaker(async () => "val", {
				name: "manual-test",
			});

			breaker.open();
			expect(breaker.isOpen).toBe(true);

			breaker.close();
			expect(breaker.isClosed).toBe(true);

			breaker.shutdown();
		});
	});
});
