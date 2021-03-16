/**
 * The goal of this is to check if some code that performs against mongo
 * state can be performed safely.
 * 
 * The algorithm works by calculating what hypothetical locks we would need to execute our work
 * in a thread-safe manner. Since, we can't actually acquire locks, we know if we need locks, 
 * we can't work safely.
 * 
 * This same logic could eventually be used to calculate locks for another storage layer.
 * However, making a general purpose algorithm limits the usefulness and adds unnecessary. 
 * Complexity at this stage.
 */

type MongoActions = {
    // Gets some global state to use locally.
    get: {id: string}, 
    // Mutates some global state with any number of dependencies on other global state.
    // Does not return any data.
    mut: {id: string, using: Set<string>}, 
}

export class Mutation implements Extract<AnyAction, {kind: "mut"}>{
    readonly kind = "mut"
    readonly id: string
    readonly using: Set<string>
    constructor(id: string, using: Iterable<string>) {
        this.id = id
        this.using = new Set(using)
    }
}
export type ActionKind = keyof MongoActions
type AnyAction = {
    [K in keyof MongoActions]: {kind: K} & MongoActions[K]
}[keyof MongoActions]
export type Action<K extends keyof MongoActions> = Extract<AnyAction, {kind: K}>

export type ActionSequence = AnyAction[]
export type LockRequirements = Map<string, "r" | "w">

export function calculate_lock_requirements(actions: ActionSequence): LockRequirements {
    const lockReqs: LockRequirements = new Map()
    const previousDep = new Set<string>()

    actions.forEach(action => {
        
        switch (action.kind) {
            case "get":
                break
            case "mut":

                if (action.using.size > 0) {
                    action.using.forEach(dependency => {
                        const original = lockReqs.get(dependency)
                        const dependencyIsSelf = dependency === action.id
                        
                        lockReqs.set(
                            dependency,
                            // Never downgrade a lock
                            original === "w" || dependencyIsSelf ? "w" : "r" 
                        )
                        previousDep.add(dependency)
                    })
                }
                if (previousDep.has(action.id)) {
                    lockReqs.set(action.id, "w")
                }
                break

            
            default: 
                const n: never = action
        }
    })

    return lockReqs
}