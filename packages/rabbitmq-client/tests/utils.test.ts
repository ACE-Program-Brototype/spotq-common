import { describe, expect, it } from "@jest/globals";
import { sanitizeError } from "../src/utils.js";

describe("RabbitMQ URL and Error Sanitization", () => {
	describe("sanitizeError", () => {
		it("should sanitize error message and stack trace containing credentials", () => {
			const rawError = new Error(
				"connect ECONNREFUSED amqp://admin:topSecretPassword@rabbitmq:5672",
			);
			rawError.stack = `Error: connect ECONNREFUSED amqp://admin:topSecretPassword@rabbitmq:5672\n    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1607:16)`;

			const sanitized = sanitizeError(rawError);
			expect(sanitized).toBeInstanceOf(Error);
			const err = sanitized as Error;
			expect(err.message).toBe(
				"connect ECONNREFUSED amqp://admin:******@rabbitmq:5672",
			);
			expect(err.message).not.toContain("topSecretPassword");
			expect(err.stack).toContain("amqp://admin:******@rabbitmq:5672");
			expect(err.stack).not.toContain("topSecretPassword");
		});

		it("should sanitize string error messages", () => {
			const raw =
				"Connection failure: amqp://user:secret@127.0.0.1:5672/vhost timed out";
			const sanitized = sanitizeError(raw);
			expect(sanitized).toBe(
				"Connection failure: amqp://user:******@127.0.0.1:5672/vhost timed out",
			);
			expect(sanitized).not.toContain("secret");
		});

		it("should return non-string non-Error values unchanged", () => {
			const obj = { code: 500 };
			expect(sanitizeError(obj)).toBe(obj);
			expect(sanitizeError(404)).toBe(404);
			expect(sanitizeError(null)).toBeNull();
		});
	});
});
