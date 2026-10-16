# SpotQ Common (`spotq-common`)

> Centralized shared utilities, middlewares, and packages for SpotQ backend microservices.

[![pnpm workspace](https://img.shields.io/badge/pnpm-workspace-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/workspaces)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-UNLICENSED-red.svg)](#)

---

## 1. Overview & Architectural Role

`spotq-common` is the standalone monorepo that houses shared, reusable TypeScript packages for the **SpotQ** backend platform. It serves the entire microservice ecosystem:

* **User Service (`spotq-user-service`)**
* **Restaurant Service (`spotq-restaurant-service`)**
* **Order Service (`spotq-order-service`)**
* **Queue Service (`spotq-queue-service`)**

Instead of copy-pasting utilities or duplicating critical security logic, shared capabilities are developed, tested, and maintained here as versioned workspace packages.

---

## 2. Packages Catalog

| Package | Version | Description | Documentation |
| :--- | :--- | :--- | :--- |
| [`@spotq-org/s2s-core`](./packages/s2s-core) | `1.0.0` | Stateless Service-to-Service (S2S) RS256 JWT auth middleware and token issuer | [View README](./packages/s2s-core/README.md) |

*(Additional shared packages like `@spotq-org/logger`, `@spotq-org/errors`, and `@spotq-org/events` will be listed here as they are added.)*

---

## 3. Monorepo Structure

```text
spotq-common/
├── pnpm-workspace.yaml         # Defines packages/* workspace layout
├── package.json                # Monorepo root scripts & dev tools
├── pnpm-lock.yaml              # Shared dependency lockfile
├── .gitignore
├── README.md                   # Global monorepo guide & catalog
└── packages/
    └── s2s-core/               # @spotq-org/s2s-core package
        ├── package.json        # Package metadata & peer dependencies
        ├── tsconfig.json       # Strict TypeScript compiler options
        ├── jest.config.ts      # TypeScript Jest configuration
        ├── README.md           # Dedicated package documentation
        ├── src/                # Library source code
        └── tests/              # Package unit tests
```

---

## 4. Monorepo Development Guide

### Prerequisites
* **Node.js**: >= 20.x (Current LTS)
* **pnpm**: >= 10.x (`npm install -g pnpm`)

### Workspace Commands

```bash
# Install dependencies across all workspace packages
pnpm install

# Build all packages
pnpm run build

# Run unit tests across all packages
pnpm run test

# Run TypeScript type check across all packages
pnpm run typecheck

# Clean compiled dist artifacts across all packages
pnpm run clean
```

---

## 5. Adding a New Package

When creating a new shared package (e.g., `packages/logger`):

1. **Create Package Directory**:
   ```bash
   mkdir -p packages/<package-name>/src packages/<package-name>/tests
   ```
2. **Configure `package.json`**:
   - Scope as `@spotq-org/<package-name>`.
   - Set `"main": "dist/index.js"` and `"types": "dist/index.d.ts"`.
   - Set `"publishConfig": { "access": "restricted" }`.
3. **Configure `tsconfig.json` & `jest.config.ts`**:
   - Target `dist/` output and enable strict mode.
4. **Document Dedicated Guide**:
   - Create `packages/<package-name>/README.md` detailing API contracts and integration examples.
5. **Register in Catalog**:
   - Add a new row to the [Packages Catalog](#2-packages-catalog) table in this root README.

---

## 6. Branching & Git Strategy

| Branch | Purpose | Protection |
| :--- | :--- | :--- |
| **`main`** | Production-ready stable release packages | Protected |
| **`staging`** | Pre-production testing and staging integration | Protected |
| **`development`** | Primary integration branch for ongoing features | Default working branch |
| **`feature/*` / `SCRUM-*`** | Feature branches branched off `development` | Merged via Pull Request |

---

## 7. License & Access

Internal proprietary software for the **SpotQ** organization. Restricted access.
