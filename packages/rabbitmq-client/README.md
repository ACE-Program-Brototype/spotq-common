# RabbitMQ Client (`@spotq-org/rabbitmq-client`)

Standard RabbitMQ client package for SpotQ microservices.

---

## 1. Quick Start

### Installation

```bash
pnpm add @spotq-org/rabbitmq-client
```

### Initialize & Connect

```typescript
import { RabbitMQClient } from "@spotq-org/rabbitmq-client";

const rmq = new RabbitMQClient({
  url: process.env.RABBITMQ_URL!, // required
  serviceName: "order-service", // required
});

await rmq.connect();
```

---

## 2. Core Functions

### Publish a Message
Sends an object as a JSON message to a queue. If the queue does not exist, it is created automatically.

Always wrap `publishToQueue` in a `try...catch` block so your application can handle network disconnects, channel unavailability, or serialization errors gracefully:

```typescript
try {
  await rmq.publishToQueue("order_created", {
    orderId: "ord_101",
    amount: 450,
  });
  console.log("Message published successfully");
} catch (error) {
  console.error("Failed to publish message:", error);
  // Handle failure (e.g., return HTTP 500, alert, or save to fallback store)
}
```

### Consume Messages
Listens to a queue and runs your handler function whenever a new message arrives.

```typescript
const handleOrderCreated = async (message: unknown) => {
  console.log("Received order:", message);
};

await rmq.consumeFromQueue("order_created", handleOrderCreated);
```

### Other Helper Functions

* **`rmq.isConnected()`**: Returns `true` if both the connection and channel are active.
  ```typescript
  if (rmq.isConnected()) {
    console.log("Ready to send messages");
  }
  ```

* **`rmq.getChannel()`**: Returns the underlying `amqplib` channel if you need raw channel operations.
  ```typescript
  const channel = rmq.getChannel();
  ```

* **`rmq.close()`**: Gracefully closes the channel and connection (useful during service shutdown).
  ```typescript
  process.on("SIGTERM", async () => {
    await rmq.close();
  });
  ```

---

## 3. Advanced Options

Both `publishToQueue` and `consumeFromQueue` accept optional settings as a third argument:

### `publishToQueue` Options

```typescript
await rmq.publishToQueue("order_created", message, {
  persistent: true,                       // Save message to disk (default: true)
  headers: { "x-correlation-id": "123" }, // Attach metadata / trace IDs
});
```

### `consumeFromQueue` Options

```typescript
await rmq.consumeFromQueue("order_created", handler, {
  requeueOnFailure: false, // If handler throws, retry in main queue instead of DLQ (default: false)
});
```

---

## 4. Dead Letter Queue (DLQ) & Acknowledgment

### Automatic DLQ Configuration
A Dead Letter Queue (`<queue_name>.dlq`) is **configured automatically** for every queue. If your consumer function throws an error, the message is automatically moved to the DLQ so no data is lost and your main queue does not get blocked.

> **Malformed JSON Handling:** If an unparseable or corrupted payload enters the queue, it is immediately routed directly to the DLQ (`requeue: false`), preventing infinite retry loops.

### How to Turn Off the DLQ
If you do not want a Dead Letter Queue for a specific queue, pass `dlq: { enabled: false }`:

```typescript
await rmq.consumeFromQueue("temp_notifications", handler, {
  dlq: { enabled: false },
});
```
*(You can also disable it globally in `new RabbitMQClient({ dlqOptions: { enabled: false } })`)*.

### How to Turn On `noAck` (Auto-Ack)
By default, messages are safely acknowledged only after your handler finishes (`noAck: false`). If you want RabbitMQ to automatically mark messages as acknowledged the moment they are delivered, set `noAck: true`:

```typescript
await rmq.consumeFromQueue("logs_queue", handler, {
  noAck: true,
});
```
