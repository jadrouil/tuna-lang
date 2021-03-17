import { Op } from '../ops/bindings';
import { ow, Utils } from '../ops/index';
import { FunctionDescription } from './function';
import { BaseNodesFromTargetSet, PickNode, PickTargetNode, TargetNodeSet } from './IR';

export type Transform<I, O> = {
    then<N>(t: Transform<O, N>): Transform<I, N>

    tap(f: (data: O) => void): Transform<I, O>
    run(i: I): O
}

export type MapTransform<I, O> = Transform<Map<string, I>, Map<string, O>>
export type Compiler<FROM> = Transform<Map<string, FunctionDescription<FROM>>, Map<string, FunctionDescription<Op>>>



export class Transformer<I, O> implements Transform<I, O> {
    readonly f: (i: I) => O
    constructor(f: (i: I) => O) {this.f= f}

    public static Map<I, O>(f: (data: I) => O): MapTransform<I, O> {

        return new Transformer((input: Map<string, I>) => {
            const out: Map<string, O> = new Map()
            input.forEach((v, k) => {
                out.set(k, f(v))
            })
            return out
        })
    }

    tap(f: (data: O) =>void): Transform<I, O> {
        return this.then(new Transformer((input) => {
            f(input)
            return input
        }))
    }
    
    then<N>(t: Transform<O, N>): Transform<I, N> {
        const f = this.f
        return new Transformer((i: I) => t.run(f(i)))
    }

    run(i: I): O {
        return this.f(i)
    }
}

const comparisonLookup: Record<PickNode<"Comparison">["sign"], Op[]> = {
    "!=": [ow.equal, ow.negatePrev],
    "==": [ow.equal],
    "<": [ow.less],
    ">": [ow.lesseq, ow.negatePrev],
    ">=": [ow.less, ow.negatePrev],
    "<=": [ow.lesseq]
}

const mathLookup: Record<PickNode<"Math">["sign"], Op[]> = {
    "+": [ow.plus],
    "-": [ow.nMinus],
    "/": [ow.nDivide],
    "*": [ow.nMult],
}

const boolAlg: Record<PickNode<"BoolAlg">["sign"], Op[]> = {
    "and": [ow.boolAnd],
    "or": [ow.boolOr]
}

// Last entry is guaranteed to be a finally
function create_well_formed_branch(n: PickTargetNode<{}, "If">): PickTargetNode<{}, "If">["conditionally"] {
    const wellFormed: PickTargetNode<{}, "If">["conditionally"] = []
    let state: "needs conditional" | "conditions" | "maybe finally" | "done" = "needs conditional"
    for (let index = 0; index < n.conditionally.length; index++) {
        const branch = n.conditionally[index];
        switch (state) {
            case "needs conditional":
                if (branch.kind !== "Conditional") {
                    throw Error(`Expected a conditional branch`)
                }
                wellFormed.push(branch)
                state = "conditions"
                break
            case "conditions":
                switch (branch.kind) {
                    case "Finally":
                        wellFormed.push(branch)
                        state = "done"
                        break
                    case "Else":
                        state = "maybe finally"
                    case "Conditional":
                        wellFormed.push(branch)
                        break
                }
                
                break
            case "maybe finally":
                if (branch.kind !== "Finally") {
                    throw Error(`Expected a finally branch`)
                }
                wellFormed.push(branch)
                state = "done"
                break
            
            default: const n: never = state
        }
        if (state === "done"){
            break
        }
        
    }

    switch (state) {
        case "needs conditional":
            throw Error(`Branch without any conditionals`)
        case "conditions":
        case "maybe finally":
            wellFormed.push({kind: "Finally", do: [{kind: "Noop"}]})
        case "done":
            break
    }
    return wellFormed

}

export function base_compiler(n: BaseNodesFromTargetSet<{}>, full_compiler: (a: TargetNodeSet<{}>) => Op[]): Op[] {
    switch (n.kind) {
        case "Bool":
        case "Int":
        case "String":
            
            return [ow.instantiate(n.value)]

        case "Math":
            return [
                ...full_compiler(n.left),
                ...full_compiler(n.right),
                ...mathLookup[n.sign]
            ]

        case "BoolAlg":
            return [
                ...full_compiler(n.left),
                ...full_compiler(n.right),
                ...boolAlg[n.sign]
            ]

        case "Comparison":
            return [
                ...full_compiler(n.left),
                ...full_compiler(n.right),
                ...comparisonLookup[n.sign]
            ]
        case "FieldExists":
            
            return [
                ...full_compiler(n.value),
                ...full_compiler(n.field),
                ow.fieldExists
            ]

        case "Object":
            return [
                ow.instantiate({}),
                ...n.fields.flatMap(full_compiler)
            ]

        case "Return":
            return n.value ? [
                ...full_compiler(n.value),
                ow.returnStackTop
            ] : [
                ow.returnVoid
            ]
        case "Call":       
            return [
                ...n.args.flatMap(full_compiler),
                ow.invoke({name: n.function_name, args: n.args.length})
            ]
        
        case "Save":
            return [...full_compiler(n.value), ow.moveStackTopToHeap]
        case "Saved":
            return [ow.copyFromHeap(n.index)]
        
        case "Field":
            return [
                ...full_compiler(n.key),                
                ...full_compiler(n.value),
                ow.setField({field_depth: 1})
            ]

        case "Update":
            
            switch (n.operation.kind) {
                case "Push": 
                    if (n.level.length > 0) {
                        return [
                            ...n.level.flatMap(full_compiler),
                            ow.instantiate([]),
                            ...n.operation.values.flatMap(v => [...full_compiler(v), ow.arrayPush]),
                            ow.pushSavedField({field_depth: n.level.length, index: n.root.index})
                        ]

                    } else {
                        return n.operation.values.flatMap(v => {
                            return [
                                ...full_compiler(v),
                                ow.moveStackToHeapArray(n.root.index)
                            ]
                        })
                    }

                case "DeleteField":
                    
                    return [
                        ...n.level.flatMap(full_compiler),
                        ow.deleteSavedField({field_depth: n.level.length, index: n.root.index}),
                    ]
                    
                default:
                    if (n.level.length === 0) {
                        return [
                            ...full_compiler(n.operation),
                            ow.overwriteHeap(n.root.index)
                        ]
                    }
                    return [
                        ...n.level.flatMap(full_compiler),
                        ...full_compiler(n.operation),                        
                        ow.setSavedField({field_depth: n.level.length, index: n.root.index}),
                    ]
            }
        case "Selection":
            if (n.level.length > 0) {
                return [
                    ...full_compiler(n.root),
                    ...n.level.flatMap(l => full_compiler(l)),
                    ow.getField({field_depth: n.level.length})
                ]
            } else {
                return full_compiler(n.root)
            }
            
        case "If":{
            const wellFormed = create_well_formed_branch(n)
            const fin = wellFormed.pop().do.flatMap(full_compiler)
            const first_to_last = wellFormed.reverse()
            const conditionals: (Op | "skip to finally")[] = []
            while (first_to_last.length > 0) {
                const this_branch = wellFormed.pop()
                const num_vars_in_branch = this_branch.do.filter(k => k.kind === "Save").length
                const drop_vars = num_vars_in_branch > 0 ? [ow.truncateHeap(num_vars_in_branch)] : []

                const this_branch_ops: (Op | "skip to finally")[] = [
                    ...this_branch.do.flatMap(full_compiler), // do this
                    ...drop_vars,
                    "skip to finally" // then skip to finally,
                ]

                switch (this_branch.kind) {
                    case "Else":
                        conditionals.push(...this_branch_ops)
                        break
                    case "Conditional":
                        conditionals.push(
                            ...full_compiler(this_branch.cond),
                            ow.negatePrev,
                            ow.conditonallySkipXops(this_branch_ops.length), // Skip to next condition
                            ...this_branch_ops,                            
                            )

                        break
                }
            }
            
            
            return [
                ...conditionals.map((op, index) => {
                    if (op === "skip to finally") {
                        return ow.offsetOpCursor({offset: conditionals.length - index, fwd: true})
                    } else {
                        return op
                    }
                }),
                ...fin
            ]
        }

        case "Noop": 
            return [ow.noop]
        case "None":
            return [ow.instantiate(null)]

        case "ArrayForEach":
            // Row variable is saved as well
            const num_vars = n.do.filter(d => d.kind === "Save").length + 1
            const loop: Op[] = [
                ow.popArray,
                ow.moveStackTopToHeap,
                ...n.do.flatMap(full_compiler),
                ow.truncateHeap(num_vars),
            ]
            loop.push(ow.offsetOpCursor({offset: loop.length + 4, fwd: false}))
            return[
                ...full_compiler(n.target),
                ow.ndArrayLen,
                ow.instantiate(0),
                ow.equal,
                ow.conditonallySkipXops(loop.length),
                ...loop,
                ow.popStack
            ]

        case "ArrayLiteral":
            const arr: Op[] = [
                ow.instantiate([]),
            ]
            n.values.forEach(v => {
                arr.push(
                    ...full_compiler(v),
                    ow.arrayPush
                )
            })
            return arr
        case "Lock":
            return [
                ...full_compiler(n.name),
                ow.lock
            ]
        case "Release":
            return [
                ...full_compiler(n.name),
                ow.release
            ]

        case "Keys":
            return [
                ...full_compiler(n.from),
                ow.getKeys
            ]

        case "GetType":
            return [
                ...full_compiler(n.value),
                ow.getType
            ]

        case "RoleInstance":
            const [_name, _] = n.role.data
            if (n.state) {
                return [
                    ow.instantiate({
                        _name
                    }),
                    ow.instantiate("_state"),
                    ...full_compiler(n.state),
                    ow.setField({field_depth: 1}),
                    ow.signRole
                ]
            } else {
                return [
                    ow.instantiate({
                        _name
                    }),
                    ow.signRole
                ]
            }
        case "Not":
            return [
                ...full_compiler(n.value),
                ow.negatePrev
            ]
        case "Is":
            return [
                ...full_compiler(n.value),
                ow.stackTopMatches({schema: n.type})
            ]
        case "Push":
        case "Conditional":
        case "Finally":
        case "Else":
        case "DeleteField": 

            throw Error(`${n.kind} should be compiled within parent`)
        default: Utils.assertNever(n)
    }
}
