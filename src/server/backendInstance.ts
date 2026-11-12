import { randomUUID } from 'node:crypto'

// Shared by WS and SSE for this backend process, independent of upstream reconnects.
export const backendInstanceId = randomUUID()
