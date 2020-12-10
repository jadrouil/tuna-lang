import {
    Transformer, 
    Transform, 
    Manifest, 
    OPSIFY_MANIFEST, 
    MONGO_GLOBAL_ABSTRACTION_REMOVAL, 
    MONGO_UNPROVIDED_LOCK_CALCULATOR, 
    StrongServerEnv,
    Var,
    ServerEnv,
    schemaFactory
} from 'conder_core'
// Need to export this
import { LockRequirements } from 'conder_core/dist/src/main/abstract/mongo_logic/lock_calculation'

import {Parser} from './parser'
import {semantify, PrivateFuncs } from './semantics'

export const TUNA_TO_MANIFEST = new Transformer<string, Manifest & PrivateFuncs>(str => {
    const p = new Parser(str).parse()
    return semantify(p, false)
})

export const TUNA_TO_LOCKS: Transform<string, Map<string, LockRequirements>> = TUNA_TO_MANIFEST.then(new Transformer(man => {
    return MONGO_GLOBAL_ABSTRACTION_REMOVAL.run(man.funcs)
})).then(MONGO_UNPROVIDED_LOCK_CALCULATOR)

export const STRINGIFY_ENV: Transform<StrongServerEnv, Omit<ServerEnv, Var.MONGO_CONNECTION_URI>> = new Transformer(env => {
    
    const string_env: Partial<ServerEnv> = {};
    for (const key in env) {
        //@ts-ignore
        string_env[key] = typeof env[key] === "string" ? env[key] : JSON.stringify(env[key]);
    }
    return string_env as ServerEnv
})

export const TUNA_TO_ENV: Transform<string, StrongServerEnv> = TUNA_TO_MANIFEST
.then(new Transformer(man => {
    const manifest = OPSIFY_MANIFEST.run(man)
    return {
        ...manifest,
        privateFuncs: man.privateFuncs
    }
}))
.then(new Transformer(man => {
    const STORES: StrongServerEnv["STORES"] = {}
    man.globals.forEach((v, k) => STORES[k] = schemaFactory.Any)

    const PROCEDURES: StrongServerEnv["PROCEDURES"] = {}
    const PRIVATE_PROCEDURES: StrongServerEnv["PRIVATE_PROCEDURES"] = [...man.privateFuncs.values()]
    man.funcs.forEach((v, k) => {
        //@ts-ignore
        PROCEDURES[k] = v
        
    })

    const SCHEMAS: StrongServerEnv["SCHEMAS"] = []
    
    return {
        DEPLOYMENT_NAME: "local-run",
        STORES,
        PROCEDURES,
        SCHEMAS,
        PRIVATE_PROCEDURES
    }
}))


export const TUNA_LOCAL_COMPILER = TUNA_TO_ENV.then(STRINGIFY_ENV)