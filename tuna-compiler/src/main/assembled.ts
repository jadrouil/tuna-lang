import {Transformer, Transform, Manifest, OPSIFY_MANIFEST, MONGO_GLOBAL_ABSTRACTION_REMOVAL, MONGO_UNPROVIDED_LOCK_CALCULATOR} from 'conder_core'
import { LockRequirements } from 'conder_core/dist/src/main/abstract/mongo_logic/lock_calculation'
// need to export this from core
import { schemaFactory, ServerEnv, StrongServerEnv, Var } from 'conder_core/dist/src/main/ops'
import {Parser} from './parser'
import {semantify } from './semantics'

export const TUNA_TO_MANIFEST = new Transformer<string, Manifest>(str => {
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
.then(OPSIFY_MANIFEST)
.then(new Transformer(man => {
    const STORES: StrongServerEnv["STORES"] = {}
    man.globals.forEach((v, k) => STORES[k] = schemaFactory.Any)

    const PROCEDURES: StrongServerEnv["PROCEDURES"] = {}
    man.funcs.forEach((v, k) => {
        PROCEDURES[k] = v
    })

    const SCHEMAS: StrongServerEnv["SCHEMAS"] = []
    
    return {
        DEPLOYMENT_NAME: "local-run",
        STORES,
        PROCEDURES,
        SCHEMAS
    }
}))


export const TUNA_LOCAL_COMPILER = TUNA_TO_ENV.then(STRINGIFY_ENV)