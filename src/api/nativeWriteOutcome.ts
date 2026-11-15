import {executionText} from './normalizers/executionDetails'
// These client-validation/method errors reject the new operations before execution.
// Internal/storage errors can follow a committed write; a numeric code alone is not proof.
export function nativeWriteRejected(error:unknown){return [-32600,-32601,-32602].includes((error as {rpcCode?:number}|null)?.rpcCode??0)}
export function nativeWriteError(error:unknown,fallback='Request failed'){return executionText(error instanceof Error?error.message.slice(0,2000):fallback).slice(0,2000)}
