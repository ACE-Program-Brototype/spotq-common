import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	jest,
} from "@jest/globals";
import amqp from "amqplib";
import { RabbitMQClient } from "../src/client.js";
import type { ILogger, MessageHandler } from "../src/types.js";

describe("RabbitMQClient", () => {
	let mockConnection: any;
	let mockChannel: any;
	let mockLogger: ILogger;

	beforeEach(() => {
		mockChannel = {
			prefetch: jest.fn(async () => undefined),
			assertExchange: jest.fn(async () => ({})),
			assertQueue: jest.fn(async () => ({ queue: "test_queue" })),
			bindQueue: jest.fn(async () => ({})),
			sendToQueue: jest.fn(() => true),
			consume: jest.fn(async () => ({ consumerTag: "tag-1" })),
			ack: jest.fn(),
			nack: jest.fn(),
			close: jest.fn(async () => undefined),
			on: jest.fn(),
		};

		mockConnection = {
			createChannel: jest.fn(async () => mockChannel),
			close: jest.fn(async () => undefined),
			on: jest.fn(),
		};

		jest.spyOn(amqp, "connect").mockResolvedValue(mockConnection as any);

		mockLogger = {
			info: jest.fn(),
			error: jest.fn(),
			warn: jest.fn(),
			debug: jest.fn(),
		};
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	describe("connect", () => {
		it("should connect and create a channel with prefetch", async () => {
			const client = new RabbitMQClient({
				url: "amqp://localhost:5672",
				serviceName: "test-service",
				logger: mockLogger,
				prefetchCount: 5,
			});

			await client.connect();

			expect(amqp.connect).toHaveBeenCalledWith("amqp://localhost:5672");
			expect(mockConnection.createChannel).toHaveBeenCalled();
			expect(mockChannel.prefetch).toHaveBeenCalledWith(5);
			expect(client.isConnected()).toBe(true);
			expect(mockLogger.info).toHaveBeenCalledWith(
				expect.stringContaining("RabbitMQ connected successfully"),
			);
		});

		it("should throw error if url is missing", async () => {
			const client = new RabbitMQClient({
				url: "",
				serviceName: "test-service",
			});

			await expect(client.connect()).rejects.toThrow(
				"[test-service] RabbitMQ URL is not defined",
			);
		});

		it("should re-throw if amqp.connect fails", async () => {
			jest
				.spyOn(amqp, "connect")
				.mockRejectedValueOnce(new Error("Connection refused"));

			const client = new RabbitMQClient({
				url: "amqp://localhost:5672",
				serviceName: "test-service",
				logger: mockLogger,
			});

			await expect(client.connect()).rejects.toThrow("Connection refused");
			expect(client.isConnected()).toBe(false);
			expect(mockLogger.error).toHaveBeenCalledWith(
				"[test-service] Failed to connect to RabbitMQ broker:",
				expect.any(Error),
			);
		});

		it("should sanitize credentials when amqp.connect throws error with password", async () => {
			const leakError = new Error(
				"connect ECONNREFUSED amqp://admin:supersecret@localhost:5672",
			);
			jest.spyOn(amqp, "connect").mockRejectedValueOnce(leakError);

			const client = new RabbitMQClient({
				url: "amqp://admin:supersecret@localhost:5672",
				serviceName: "test-service",
				logger: mockLogger,
			});

			await expect(client.connect()).rejects.toThrow(
				"connect ECONNREFUSED amqp://admin:******@localhost:5672",
			);

			const calls = (mockLogger.error as jest.Mock).mock.calls;
			expect(calls.length).toBeGreaterThan(0);
			const loggedError = calls[0]?.[1] as Error;
			expect(loggedError.message).not.toContain("supersecret");
			expect(loggedError.message).toContain("******");
		});
	});

	describe("publishToQueue", () => {
		it("should assert queue with DLQ arguments on first publish and send message", async () => {
			const client = new RabbitMQClient({
				url: "amqp://localhost:5672",
				serviceName: "test-service",
				logger: mockLogger,
			});

			await client.connect();

			const message = { id: 1, name: "Order" };
			const result = await client.publishToQueue("orders", message);

			expect(result).toBe(true);

			// Check DLX assertion
			expect(mockChannel.assertExchange).toHaveBeenCalledWith(
				"spotq.dlx",
				"direct",
				{ durable: true },
			);

			// Check DLQ assertion
			expect(mockChannel.assertQueue).toHaveBeenCalledWith("orders.dlq", {
				durable: true,
			});

			// Check DLQ binding to DLX
			expect(mockChannel.bindQueue).toHaveBeenCalledWith(
				"orders.dlq",
				"spotq.dlx",
				"orders.dlq",
			);

			// Check main queue assertion with DLQ arguments
			expect(mockChannel.assertQueue).toHaveBeenCalledWith("orders", {
				durable: true,
				arguments: {
					"x-dead-letter-exchange": "spotq.dlx",
					"x-dead-letter-routing-key": "orders.dlq",
				},
			});

			// Check sendToQueue
			expect(mockChannel.sendToQueue).toHaveBeenCalledWith(
				"orders",
				Buffer.from(JSON.stringify(message)),
				{ persistent: true, headers: undefined },
			);
		});

		it("should NOT re-assert queue on second publish (in-memory caching)", async () => {
			const client = new RabbitMQClient({
				url: "amqp://localhost:5672",
				serviceName: "test-service",
				logger: mockLogger,
			});

			await client.connect();

			await client.publishToQueue("orders", { msg: 1 });
			await client.publishToQueue("orders", { msg: 2 });

			// DLX, DLQ, and binding should only be asserted ONCE
			expect(mockChannel.assertExchange).toHaveBeenCalledTimes(1);
			expect(mockChannel.bindQueue).toHaveBeenCalledTimes(1);
			expect(mockChannel.sendToQueue).toHaveBeenCalledTimes(2);
		});

		it("should throw error if channel is not connected", async () => {
			const client = new RabbitMQClient({
				url: "amqp://localhost:5672",
				serviceName: "test-service",
				logger: mockLogger,
			});

			await expect(
				client.publishToQueue("orders", { test: true }),
			).rejects.toThrow("RabbitMQ channel is not available");
			expect(mockLogger.error).toHaveBeenCalled();
		});
	});

	describe("consumeFromQueue with ACK & DLQ", () => {
		it("should send positive ACK when handler succeeds", async () => {
			const client = new RabbitMQClient({
				url: "amqp://localhost:5672",
				serviceName: "test-service",
				logger: mockLogger,
			});

			await client.connect();

			const handler = jest.fn<MessageHandler<any>>(async () => {});
			await client.consumeFromQueue("orders", handler);

			// Extract the consumer callback that was passed to channel.consume
			const consumerCallback = mockChannel.consume.mock.calls[0][1];

			const fakeMessage = {
				content: Buffer.from(JSON.stringify({ orderId: "123" })),
			};

			// Simulate receiving a message
			await consumerCallback(fakeMessage);

			expect(handler).toHaveBeenCalledWith(
				{ orderId: "123" },
				fakeMessage as any,
			);
			expect(mockChannel.ack).toHaveBeenCalledWith(fakeMessage);
			expect(mockChannel.nack).not.toHaveBeenCalled();
		});

		it("should send negative NACK (requeue=false) to route to DLQ when handler fails", async () => {
			const client = new RabbitMQClient({
				url: "amqp://localhost:5672",
				serviceName: "test-service",
				logger: mockLogger,
			});

			await client.connect();

			const handler = jest.fn<MessageHandler<any>>(async () => {
				throw new Error("Database down");
			});
			await client.consumeFromQueue("orders", handler);

			const consumerCallback = mockChannel.consume.mock.calls[0][1];
			const fakeMessage = {
				content: Buffer.from(JSON.stringify({ orderId: "failed-order" })),
			};

			// Simulate receiving a message that fails in handler
			await consumerCallback(fakeMessage);

			expect(handler).toHaveBeenCalled();
			expect(mockChannel.ack).not.toHaveBeenCalled();
			// NACK with requeue=false routes directly to the DLQ!
			expect(mockChannel.nack).toHaveBeenCalledWith(fakeMessage, false, false);
			expect(mockLogger.error).toHaveBeenCalledWith(
				expect.stringContaining("Error processing message"),
				expect.any(Error),
			);
		});

		it("should NACK with requeue=true if requeueOnFailure is true", async () => {
			const client = new RabbitMQClient({
				url: "amqp://localhost:5672",
				serviceName: "test-service",
				logger: mockLogger,
			});

			await client.connect();

			const handler = jest.fn<MessageHandler<any>>(async () => {
				throw new Error("Transient error");
			});
			await client.consumeFromQueue("orders", handler, {
				requeueOnFailure: true,
			});

			const consumerCallback = mockChannel.consume.mock.calls[0][1];
			const fakeMessage = { content: Buffer.from(JSON.stringify({ id: 1 })) };

			await consumerCallback(fakeMessage);

			expect(mockChannel.nack).toHaveBeenCalledWith(fakeMessage, false, true);
		});

		it("should NACK with requeue=false (send to DLQ) when JSON is malformed, even if requeueOnFailure is true", async () => {
			const client = new RabbitMQClient({
				url: "amqp://localhost:5672",
				serviceName: "test-service",
				logger: mockLogger,
			});

			await client.connect();

			const handler = jest.fn<MessageHandler<any>>(async () => {});
			await client.consumeFromQueue("orders", handler, {
				requeueOnFailure: true,
			});

			const consumerCallback = mockChannel.consume.mock.calls[0][1];
			const malformedMessage = {
				content: Buffer.from("{ bad json: not valid ..."),
			};

			await consumerCallback(malformedMessage);

			// Handler should never be invoked for malformed JSON
			expect(handler).not.toHaveBeenCalled();
			expect(mockChannel.ack).not.toHaveBeenCalled();
			// Must be NACKed with requeue=false to avoid CPU 100% infinite loop
			expect(mockChannel.nack).toHaveBeenCalledWith(
				malformedMessage,
				false,
				false,
			);
			expect(mockLogger.error).toHaveBeenCalledWith(
				expect.stringContaining("Malformed JSON received from queue"),
				expect.any(SyntaxError),
			);
		});

		it("should not call ack or nack if noAck is true", async () => {
			const client = new RabbitMQClient({
				url: "amqp://localhost:5672",
				serviceName: "test-service",
				logger: mockLogger,
			});

			await client.connect();

			const handler = jest.fn<MessageHandler<any>>(async () => {});
			await client.consumeFromQueue("orders", handler, { noAck: true });

			const consumerCallback = mockChannel.consume.mock.calls[0][1];
			const fakeMessage = { content: Buffer.from(JSON.stringify({ id: 1 })) };

			await consumerCallback(fakeMessage);

			expect(handler).toHaveBeenCalled();
			expect(mockChannel.ack).not.toHaveBeenCalled();
			expect(mockChannel.nack).not.toHaveBeenCalled();
		});
	});

	describe("close", () => {
		it("should close channel and connection gracefully", async () => {
			const client = new RabbitMQClient({
				url: "amqp://localhost:5672",
				serviceName: "test-service",
				logger: mockLogger,
			});

			await client.connect();
			expect(client.isConnected()).toBe(true);

			await client.close();

			expect(mockChannel.close).toHaveBeenCalled();
			expect(mockConnection.close).toHaveBeenCalled();
			expect(client.isConnected()).toBe(false);
			expect(mockLogger.info).toHaveBeenCalledWith(
				expect.stringContaining("RabbitMQ connection closed gracefully"),
			);
		});
	});

	describe("auto-reconnect and consumer resubscription", () => {
		it("should schedule reconnect and re-subscribe consumers when connection drops", async () => {
			jest.useFakeTimers();
			const client = new RabbitMQClient({
				url: "amqp://localhost:5672",
				serviceName: "test-service",
				logger: mockLogger,
			});

			await client.connect();

			const handler = jest.fn<MessageHandler<any>>(async () => {});
			await client.consumeFromQueue("orders", handler);

			// Extract connection 'close' listener
			const closeListener = mockConnection.on.mock.calls.find(
				(call: any[]) => call[0] === "close",
			)?.[1];

			expect(closeListener).toBeDefined();

			// Simulate unexpected connection drop
			closeListener();
			expect(client.isConnected()).toBe(false);

			// Fast-forward 5 seconds to trigger reconnect timer
			await jest.advanceTimersByTimeAsync(5000);

			expect(amqp.connect).toHaveBeenCalledTimes(2);
			// Check consumer was re-subscribed
			expect(mockChannel.consume).toHaveBeenCalledTimes(2);
			expect(client.isConnected()).toBe(true);

			await client.close();
			jest.useRealTimers();
		});

		it("should NOT reconnect if close() was called explicitly", async () => {
			jest.useFakeTimers();
			const client = new RabbitMQClient({
				url: "amqp://localhost:5672",
				serviceName: "test-service",
				logger: mockLogger,
			});

			await client.connect();
			await client.close();

			const closeListener = mockConnection.on.mock.calls.find(
				(call: any[]) => call[0] === "close",
			)?.[1];

			if (closeListener) {
				closeListener();
			}

			await jest.advanceTimersByTimeAsync(5000);
			// Connect should still only have been called once (from initial connect)
			expect(amqp.connect).toHaveBeenCalledTimes(1);

			jest.useRealTimers();
		});
	});
});
