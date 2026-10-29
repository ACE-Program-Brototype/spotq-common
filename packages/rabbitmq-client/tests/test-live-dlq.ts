import process from "node:process";
import type { ConsumeMessage } from "amqplib";
import { RabbitMQClient } from "../src/index.js";

/**
 * Live test script to verify Dead Letter Queue (DLQ) behavior against a real RabbitMQ broker.
 *
 * Requirements:
 * - Docker RabbitMQ running: `docker compose up -d rabbitmq` (in spotq-infra)
 *
 * Run:
 *   pnpm run test:live
 *   or: node --experimental-strip-types tests/test-live-dlq.ts
 */
async function runLiveDlqTest() {
	const rabbitUrl =
		process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672";
	const testQueue = "spotq.test.orders";
	const dlqQueue = `${testQueue}.dlq`;

	console.log("=== RabbitMQ Live DLQ Test ===");
	console.log(`Connecting to broker at ${rabbitUrl}...`);

	const client = new RabbitMQClient({
		url: rabbitUrl,
		serviceName: "live-dlq-tester",
		prefetchCount: 5,
	});

	try {
		await client.connect();
		console.log("✓ Connected to RabbitMQ\n");

		let dlqReceivedPromiseResolve: (value: unknown) => void;
		const dlqReceivedPromise = new Promise((resolve) => {
			dlqReceivedPromiseResolve = resolve;
		});

		// 1. Listen on the DLQ directly to verify message gets routed there
		console.log(`[Step 1] Subscribing to Dead Letter Queue: "${dlqQueue}"...`);
		await client.consumeFromQueue(
			dlqQueue,
			async (content: unknown, rawMsg: ConsumeMessage) => {
				console.log("\n🎯 [DLQ Consumer] Received dead-lettered message!");
				console.log("  Payload:", JSON.stringify(content));
				console.log("  Routing Key:", rawMsg.fields.routingKey);
				console.log("  Exchange:", rawMsg.fields.exchange);
				dlqReceivedPromiseResolve(content);
			},
			{
				dlq: { enabled: false }, // Don't create a DLQ for the DLQ itself
			},
		);

		// 2. Set up a consumer on the main queue that intentionally fails
		console.log(
			`[Step 2] Subscribing failing consumer to main queue: "${testQueue}"...`,
		);
		let failureCount = 0;
		await client.consumeFromQueue(
			testQueue,
			async (content: unknown) => {
				failureCount++;
				console.log(
					`\n💥 [Main Consumer] Received order payload (attempt #${failureCount}):`,
					content,
				);
				console.log(
					"💥 [Main Consumer] Simulating an unhandled crash to trigger DLQ routing...",
				);
				throw new Error(
					"Simulated order processing failure (e.g. database error)",
				);
			},
			{
				dlq: {
					enabled: true,
				},
				requeueOnFailure: false, // Don't requeue, send straight to DLQ
			},
		);

		// 3. Publish a message to the main queue
		const testOrder = {
			orderId: `ord-${Date.now()}`,
			customer: "soorya",
			amount: 49.99,
			reason: "Testing DLQ routing",
		};

		console.log(`\n[Step 3] Publishing test order to "${testQueue}"...`);
		const sent = await client.publishToQueue(testQueue, testOrder);
		console.log(`✓ Message dispatched: ${sent}\n`);

		// 4. Wait for DLQ consumer to capture it
		console.log("[Step 4] Waiting for message to be routed to DLQ...");
		const timeout = new Promise((_, reject) =>
			setTimeout(
				() => reject(new Error("Timeout waiting for message in DLQ")),
				8000,
			),
		);

		await Promise.race([dlqReceivedPromise, timeout]);

		console.log("\n=======================================================");
		console.log("🎉 SUCCESS: DLQ End-to-End Test Passed!");
		console.log("   Original published message was rejected by main handler");
		console.log("   and safely redirected to the Dead Letter Queue.");
		console.log("=======================================================\n");

		await client.close();
		process.exit(0);
	} catch (error) {
		const err = error as Error & { code?: string };
		console.error("\n❌ Live test failed:", err.message);
		if (err.code === "ECONNREFUSED") {
			console.error("\nIs RabbitMQ running in Docker? Start it with:");
			console.error("  cd spotq-infra && docker compose up -d rabbitmq\n");
		}
		await client.close().catch(() => {});
		process.exit(1);
	}
}

runLiveDlqTest();
