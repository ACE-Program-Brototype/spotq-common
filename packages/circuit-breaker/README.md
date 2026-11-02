# Circuit Breaker (`@spotq-org/circuit-breaker`)

Standardized circuit breaker package for SpotQ microservices. Prevents cascading failures, fast-fails during downstream outages, and supports graceful fallbacks.

---

## 1. Quick Start

### Installation

```bash
pnpm add @spotq-org/circuit-breaker
```

### Initialize & Wrap

```typescript
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

// 2. Wrap it in a CircuitBreaker (only `name` is required!)
export const restaurantBreaker = new CircuitBreaker(getRestaurant, {
  name: "restaurant-service", // required
});

// 3. Execute through the breaker
try {
  const data = await restaurantBreaker.execute("rest_101");
  console.log("Restaurant:", data);
} catch (error) {
  if (error instanceof CircuitBreakerOpenError) {
    // Fast-fail: Downstream is down, request blocked without touching network
    return res.status(503).json({ error: "Restaurant service unavailable" });
  }
  if (error instanceof CircuitBreakerTimeoutError) {
    return res.status(504).json({ error: "Restaurant service timed out" });
  }
  throw error;
}
```

---

## 2. Configuration (`CircuitBreakerOptions`)

When instantiating `new CircuitBreaker(action, options)`, `options` accepts the following settings. All fields except **`name`** have sensible production defaults:

| Option | Type | Required? | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| **`name`** | `string` | **YES** | — | Unique identifier for this breaker. Used in logs, metric labels, and error messages. |
| **`timeoutMs`** | `number` | Optional | `10000` (10s) | Max time to wait for a single request before timing out. Set to `0` to disable timeouts. |
| **`resetTimeoutMs`** | `number` | Optional | `10000` (10s) | Cooldown duration in `OPEN` state before transitioning to `HALF_OPEN` for a trial probe. |
| **`errorThresholdPercentage`** | `number` | Optional | `50` (50%) | Percentage of failed requests within the rolling window that trips the circuit to `OPEN`. |
| **`volumeThreshold`** | `number` | Optional | `5` | Minimum number of requests in the window before failure rate is evaluated. (Prevents tripping on the first request). |
| **`rollingWindowMs`** | `number` | Optional | `10000` (10s) | Duration of the sliding statistical evaluation window. |
| **`rollingWindowBuckets`** | `number` | Optional | `10` | Number of time buckets partitioning the rolling window (e.g. 10 buckets = 1s per bucket). |
| **`checkIsFailure`** | `(err) => boolean` | Optional | `() => true` | Predicate function to determine which errors count as circuit failures. |
| **`fallback`** | `FallbackFunction` | Optional | `undefined` | Backup function to run when the circuit is `OPEN`, timed out, or failing. |
| **`onOpen`** | `() => void` | Optional | `undefined` | Hook called when the circuit trips to `OPEN`. |
| **`onClose`** | `() => void` | Optional | `undefined` | Hook called when the circuit recovers to `CLOSED`. |
| **`onHalfOpen`** | `() => void` | Optional | `undefined` | Hook called when the circuit enters `HALF_OPEN`. |
| **`onFallback`** | `(result, err) => void` | Optional | `undefined` | Hook called when fallback executes. |

---

## 3. Circuit States

| State | What it means | What happens to requests |
| :--- | :--- | :--- |
| **`CLOSED`** | Healthy. | Requests pass directly to downstream. Successes and failures are tracked in rolling buckets. |
| **`OPEN`** | Outage detected. | **No network calls are made.** Calls fail fast in 0ms (or invoke fallback). |
| **`HALF_OPEN`** | Cooldown finished. | Sends **one trial request** to test if the downstream service has recovered. If it succeeds, circuit resets to `CLOSED`. If it fails, it trips back to `OPEN`. |

```typescript
import { CircuitBreakerState } from "@spotq-org/circuit-breaker";

if (restaurantBreaker.state === CircuitBreakerState.OPEN) {
  console.log("Downstream is down!");
}

console.log(restaurantBreaker.isOpen);     // boolean
console.log(restaurantBreaker.isClosed);   // boolean
console.log(restaurantBreaker.isHalfOpen); // boolean
```

---

## 4. Custom Failure Filtering (`checkIsFailure`)

In HTTP microservices, a `404 Not Found` or `400 Bad Request` represents a domain or user validation condition, **not** an upstream server crash. Counting 4xx errors toward circuit failure statistics would cause false outages.

Use `checkIsFailure` to exclude non-transient errors:

```typescript
const breaker = new CircuitBreaker(fetchData, {
  name: "restaurant-service",
  checkIsFailure: (error: any) => {
    // Return false = DO NOT count as a circuit failure (ignore it)
    if (error.response && error.response.status < 500) {
      return false;
    }
    // Return true = COUNT as a circuit failure (500, network disconnect, timeout)
    return true;
  },
});
```

* When `checkIsFailure(err)` returns `false`: The error is thrown back to your caller normally, but the failure counter is **not** incremented.
* When `checkIsFailure(err)` returns `true`: It counts toward the threshold and can trip the breaker to `OPEN`.

---

## 5. Fallback Handling

A fallback provides a safe backup value when downstream is down or timed out.

You can configure fallback in options or via method chaining:

```typescript
// Via options:
const breaker = new CircuitBreaker(fetchRestaurant, {
  name: "restaurant-service",
  fallback: (restaurantId, error) => {
    return { id: restaurantId, name: "Cached Restaurant", isCached: true };
  },
});

// Or via method chaining:
breaker.fallback((restaurantId, error) => {
  return { id: restaurantId, name: "Cached Restaurant", isCached: true };
});
```

> **Note:** If you do **not** provide a fallback (e.g. for payments or order placement), the circuit breaker throws `CircuitBreakerOpenError` so you can return an HTTP 503 status.

---

## 6. Metrics & Observability

You can monitor circuit transitions using lifecycle hooks or event listeners:

```typescript
const breaker = new CircuitBreaker(fetchData, {
  name: "restaurant-service",
  onOpen: () => logger.warn("restaurant-service breaker tripped to OPEN!"),
  onClose: () => logger.info("restaurant-service recovered to CLOSED!"),
  onHalfOpen: () => logger.info("restaurant-service testing trial probe in HALF_OPEN"),
});

// Or subscribe via EventEmitter:
breaker.on("open", () => prometheusTripsCounter.inc({ breaker: "restaurant-service" }));
breaker.on("close", () => logger.info("Recovered"));
```

---

## 7. Other Helper Functions

* **`breaker.open()`**: Manually trips the circuit breaker into `OPEN` state.
  ```typescript
  breaker.open();
  ```

* **`breaker.close()`**: Manually resets the circuit breaker into `CLOSED` state.
  ```typescript
  breaker.close();
  ```

* **`breaker.shutdown()`**: Stops internal timers (useful during graceful service shutdown).
  ```typescript
  process.on("SIGTERM", () => {
    breaker.shutdown();
  });
  ```
