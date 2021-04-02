import * as bind from './bindings'
export type StrongServerEnv = {
    PROCEDURES: Record<string, bind.Op[]>,
    PRIVATE_PROCEDURES?: string[],
    SCHEMAS: Record<string, bind.Schema>,
    STORES: Record<string, bind.Schema>,
    ETCD_URL?: string,
    PRIVATE_KEY: Uint8Array,
    PUBLIC_KEY: Uint8Array,
    DEPLOYMENT_NAME: string,
}

export type ServerEnv = Record<keyof StrongServerEnv, string>