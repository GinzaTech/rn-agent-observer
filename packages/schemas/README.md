# `@rn-agent-observer/schemas`

Shared Zod schemas and TypeScript types for RN Agent Observer evidence, sessions,
metrics, UI models, diagnosis, and protocol responses.

## Install

```sh
pnpm add @rn-agent-observer/schemas
```

```ts
import {
  ObservationSchema,
  type Observation,
} from '@rn-agent-observer/schemas';

const observation: Observation = ObservationSchema.parse(input);
```

This is an ESM package for Node.js 22.12 or newer. Consumers should parse
untrusted evidence at the boundary instead of asserting it as a TypeScript type.

See the [protocol reference](https://github.com/GinzaTech/rn-agent-observer/blob/main/docs/protocol.md)
and [repository](https://github.com/GinzaTech/rn-agent-observer).
