import {
    Manifest, 
    StrongServerEnv,
    ServerEnv,
    functionsToOps,
} from './backend/index'
import * as ed from 'noble-ed25519'

import {Parser} from './frontend/parser'
import {semantify, PrivateFuncs, Schemas } from './frontend/semantics'

export function TUNA_TO_MANIFEST(s: string): Manifest & PrivateFuncs & Schemas {
    const p = new Parser(s).parse()
    return semantify(p, false)
}
type Keys = "PRIVATE_KEY" | "PUBLIC_KEY"
type Keyless = Omit<StrongServerEnv, Keys>

export function STRINGIFY_ENV(env: Keyless): Omit<ServerEnv, Keys> {
    
    const string_env: Partial<ServerEnv> = {};
    for (const key in env) {
        //@ts-ignore
        string_env[key] = typeof env[key] === "string" ? env[key] : JSON.stringify(env[key]);
    }
    return string_env as ServerEnv
}

export function TUNA_TO_ENV(s: string): Keyless {
    const man = TUNA_TO_MANIFEST(s)
    const PROCEDURES = functionsToOps(man.funcs)
    const STORES: StrongServerEnv["STORES"] = {}
    man.globals.forEach((v, k) => STORES[k] = {kind: "Any", data: null})
    return {
        DEPLOYMENT_NAME: "local-run",
        STORES,
        PROCEDURES,
        PRIVATE_PROCEDURES: [...man.privateFuncs.values()],
        SCHEMAS: man.schemas
    }
    
}


export const TUNA_LOCAL_COMPILER = (s: string) => STRINGIFY_ENV(TUNA_TO_ENV(s))