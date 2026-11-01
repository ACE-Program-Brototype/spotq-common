# @spotq-org/circuit-breaker

A standardized, configurable circuit breaker for SpotQ microservices. Prevents cascading failures, fast-fails during downstream outages, and supports graceful fallbacks.

---

## 1. Quick Start

### Installation

```bash
pnpm add @spotq-org/circuit-breaker
```

### Basic Example (Wrapping an Axios call)

```typescript
import axios from "axios";
import {
  CircuitBreaker,
  CircuitBreakerOpenError,
  CircuitBreakerTimeoutError,
} from "@spotq-org/circuit-breaker";

// 1. Your normal HTTP function
async function getRestaurant(id: string) {
  const res = await axios.get(`https://restaurant-service/api/${id}`);
  return res.data;
}

// 2. Wrap it in a CircuitBreaker
export const restaurantBreaker = new CircuitBreaker(getRestaurant, {
  name: "restaurant-service", // REQUIRED: unique name for metrics and logs
  timeoutMs: 3000,            // Cancel request if it takes longer than 3s
  errorThresholdPercentage: 50, // Trip to OPEN if >= 50% requests fail
  resetTimeoutMs: 10000,      // Cooldown for 10s before testing recovery

  // Optional: Exclude 4xx user errors from tripping the breaker
  isFailure: (error: any) => {
    if (error.response && error.response.status < 500) {
      return false; // 404 Not Found or 400 Bad Request is NOT a server outage
    }
    return true; // 500 errors, network drops, and timeouts ARE failures
  },

  // Optional: Return cached or safe data when service is down
  fallback: (id, error) => {
    return { id, name: "Temporarily Offline (Cached)", isOffline: true };
  },
});

// 3. In your controller: Call execute() instead of calling Axios directly!
app.get("/restaurants/:id", async (req, res) => {
  try {
    const data = await restaurantBreaker.execute(req.params.id);
    return res.json(data);
  } catch (err) {
    // Use the error classes for clean, type-safe HTTP status mapping!
    if (err instanceof CircuitBreakerOpenError) {
      return res.status(503).json({ error: "Restaurant service is currently unavailable" });
    }
    if (err instanceof CircuitBreakerTimeoutError) {
      return res.status(504).json({ error: "Restaurant service timed out" });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
});
```

---

## 2. Circuit States

| State | What it means | What happens to requests |
| :--- | :--- | :--- |
| **`CLOSED`** | Healthy. | Requests pass directly to downstream. Successes and failures are tracked. |
| **`OPEN`** | Outage detected. | **No network calls are made.** Calls fail fast in 0ms (or return fallback). |
| **`HALF_OPEN`** | Cooldown finished. | Sends **one trial request** to test if the downstream service has recovered. If it succeeds, circuit resets to `CLOSED`. If it fails, it trips back to `OPEN`. |

---

## 3. Configuration Options (`CircuitBreakerOptions`)

| Option | Type | Required? | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| **`name`** | `string` | **YES (Required)** | — | Unique identifier for this breaker. Used in logs, metric labels, and error messages. |
| **`timeoutMs`** | `number` | Optional | `10000` (10s) | Max time to wait for a single request before timing out. Set to `0` to disable timeouts. |
| **`resetTimeoutMs`** | `number` | Optional | `10000` (10s) | How long the breaker stays `OPEN` before testing `HALF_OPEN`. |
| **`errorThresholdPercentage`** | `number` | Optional | `50` (50%) | Percentage of failed requests within the rolling window that trips the circuit to `OPEN`. |
| **`volumeThreshold`** | `number` | Optional | `5` | Minimum number of requests in the window before failure rate is evaluated. (Prevents tripping on the very first request). |
| **`rollingWindowMs`** | `number` | Optional | `10000` (10s) | Duration of the sliding statistical evaluation window. |
| **`rollingWindowBuckets`** | `number` | Optional | `10` | Number of time buckets partitioning the rolling window (e.g. 10 buckets = 1s per bucket). |
| **`isFailure`** | `(err) => boolean` | Optional | `() => true` | Predicate to filter which errors count as circuit failures. |
| **`fallback`** | `Function` | Optional | `undefined` | Backup function to run when the circuit is `OPEN`, timed out, or failing. |
| **`onOpen`** | `() => void` | Optional | `undefined` | Hook called when the circuit trips to `OPEN`. |
| **`onClose`** | `() => void` | Optional | `undefined` | Hook called when the circuit recovers to `CLOSED`. |
| **`onHalfOpen`** | `() => void` | Optional | `undefined` | Hook called when the circuit enters `HALF_OPEN`. |
| **`onFallback`** | `(result, err) => void` | Optional | `undefined` | Hook called when fallback executes. |

---

## 4. Custom Error Filtering (`isFailure`)

In HTTP APIs, a `404 Not Found` or `400 Bad Request` is a user typo, **not** an upstream server crash. If 10 users query missing IDs, you do **not** want your circuit breaker to trip!

Use `isFailure` to ignore 4xx errors:

```typescript
const breaker = new CircuitBreaker(fetchData, {
  name: "my-service",
  isFailure: (error: any) => {
    // Return false = DO NOT count as a circuit failure (ignore it)
    if (error.response?.status < 500) {
      return false;
    }
    // Return true = COUNT as a circuit failure (500, network disconnect, timeout)
    return true;
  },
});
```

- When `isFailure(err)` returns `false`: The error is thrown to your caller normally, but the failure counter is **not** incremented.
- When `isFailure(err)` returns `true`: It counts toward the threshold and can trip the breaker to `OPEN`.

---

## 5. Fallback Handling

A fallback provides a safe backup value when downstream is dead or timed out.

You can configure fallback in options or via method chaining:

```typescript
// Via options:
const breaker = new CircuitBreaker(fetchRestaurant, {
  name: "restaurant-service",
  fallback: (restaurantId, error) => {
    return { id: restaurantId, name: "Cached Restaurant" };
  },
});

// Or via method chaining:
breaker.fallback((restaurantId, error) => {
  return { id: restaurantId, name: "Cached Restaurant" };
});
```

> **Note:** If you do **not** provide a fallback (e.g. for payments or order placement), the circuit breaker will throw `CircuitBreakerOpenError`.

---

## 6. Type-Safe Error Handling

Always use `instanceof` with the exported error classes to handle catch blocks cleanly:

```typescript
try {
  await breaker.execute(id);
} catch (err) {
  if (err instanceof CircuitBreakerOpenError) {
    // Fast-fail: Downstream is down, request was blocked without touching network
    return res.status(503).json({ error: "Service currently unavailable" });
  }

  if (err instanceof CircuitBreakerTimeoutError) {
    // Request took longer than timeoutMs
    return res.status(504).json({ error: "Service timed out" });
  }

  // Original business error from downstream
  throw err;
}
```

---

## 7. Metrics & Observability

You can monitor circuit transitions using lifecycle hooks or event listeners:

```typescript
const breaker = new CircuitBreaker(fetchData, {
  name: "restaurant-service",
  onOpen: () => logger.warn("restaurant-service breaker tripped to OPEN!"),
  onClose: () => logger.info("restaurant-service recovered to CLOSED!"),
  onHalfOpen: () => logger.info("restaurant-service testing trial probe in HALF_OPEN"),
});

// Or subscribe with .on()
breaker.on("open", () => prometheusTripsCounter.inc());
breaker.on("close", () => logger.info("Recovered"));
```

### Manual Overrides (Testing / Admin Controls)

```typescript
breaker.open();      // Manually force breaker to OPEN
breaker.close();     // Manually force breaker to CLOSED
breaker.shutdown();  // Stop internal timers when application shuts down
```

