import { Op } from '../ops/bindings';
import { ow, Utils } from '../ops/index';
import { FunctionDescription } from './function';
import { BaseNodesFromTargetSet, PickNode, PickTargetNode, TargetNodeSet } from './IR';
import { IVariableResolver } from './variable_resolution';

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
export function base_compiler(n: BaseNodesFromTargetSet<{}>, full_compiler: (a: TargetNodeSet<{}>, args: IVariableResolver) => Op[], context: IVariableResolver): Op[] {
    switch (n.kind) {
        case "Bool":
        case "Int":
        case "String":
            
            return [ow.instantiate(n.value)]

        case "Math":
            return [
                ...full_compiler(n.left, context),
                ...full_compiler(n.right, context),
                ...mathLookup[n.sign]
            ]

        case "BoolAlg":
            return [
                ...full_compiler(n.left, context),
                ...full_compiler(n.right, context),
                ...boolAlg[n.sign]
            ]

        case "Comparison":
            return [
                ...full_compiler(n.left, context),
                ...full_compiler(n.right, context),
                ...comparisonLookup[n.sign]
            ]
        case "FieldExists":
            
            return [
                ...full_compiler(n.value, context),
                ...full_compiler(n.field, context),
                ow.fieldExists
            ]

        case "Object":
            return [
                ow.instantiate({}),
                ...n.fields.flatMap((node) => full_compiler(node, context))
            ]

        case "Return":
            return n.value ? [
                ...full_compiler(n.value, context),
                ow.returnStackTop
            ] : [
                ow.returnVoid
            ]
        case "Call":       
            return [
                ...n.args.flatMap(node => full_compiler(node, context)),
                ow.invoke({name: n.function_name, args: n.args.length})
            ]
        
        case "Save":
            context.add(n.name)
            return [...full_compiler(n.value, context), ow.moveStackTopToHeap]
        case "Saved":
            return [ow.copyFromHeap(context.get(n.arg))]
        
        case "Field":
            return [
                ...full_compiler(n.key, context),                
                ...full_compiler(n.value, context),
                ow.setField({field_depth: 1})
            ]

        case "Update":
            
            switch (n.operation.kind) {
                case "Push": 
                    if (n.level.length > 0) {
                        return [
                            ...n.level.flatMap(node => full_compiler(node, context)),
                            ow.instantiate([]),
                            ...n.operation.values.flatMap(v => [...full_compiler(v, context), ow.arrayPush]),
                            ow.pushSavedField({field_depth: n.level.length, index: context.get(n.root.arg)})
                        ]

                    } else {
                        return n.operation.values.flatMap(v => {
                            return [
                                ...full_compiler(v, context),
                                ow.moveStackToHeapArray(context.get(n.root.arg))
                            ]
                        })
                    }

                case "DeleteField":
                    
                    return [
                        ...n.level.flatMap(node => full_compiler(node, context)),
                        ow.deleteSavedField({field_depth: n.level.length, index: context.get(n.root.arg)}),
                    ]
                    
                default:
                    if (n.level.length === 0) {
                        return [
                            ...full_compiler(n.operation, context),
                            ow.overwriteHeap(context.get(n.root.arg))
                        ]
                    }
                    return [
                        ...n.level.flatMap(node => full_compiler(node, context)),
                        ...full_compiler(n.operation, context),                        
                        ow.setSavedField({field_depth: n.level.length, index: context.get(n.root.arg)}),
                    ]
            }
        case "Selection":
            if (n.level.length > 0) {
                return [
                    ...full_compiler(n.root, context),
                    ...n.level.flatMap(node => full_compiler(node, context)),
                    ow.getField({field_depth: n.level.length})
                ]
            } else {
                return full_compiler(n.root, context)
            }
            
        case "If":{
            context.push()
            const wellFormed = create_well_formed_branch(n)
            const fin = wellFormed.pop().do.flatMap(node => full_compiler(node, context))
            const first_to_last = wellFormed.reverse()
            const conditionals: (Op | "skip to finally")[] = []
            while (first_to_last.length > 0) {
                const this_branch = wellFormed.pop()
                const num_vars_in_branch = this_branch.do.filter(k => k.kind === "Save").length
                const drop_vars = num_vars_in_branch > 0 ? [ow.truncateHeap(num_vars_in_branch)] : []

                const this_branch_ops: (Op | "skip to finally")[] = [
                    ...this_branch.do.flatMap(node => full_compiler(node, context)), // do this
                    ...drop_vars,
                    "skip to finally" // then skip to finally,
                ]

                switch (this_branch.kind) {
                    case "Else":
                        conditionals.push(...this_branch_ops)
                        break
                    case "Conditional":
                        conditionals.push(
                            ...full_compiler(this_branch.cond, context),
                            ow.negatePrev,
                            ow.conditonallySkipXops(this_branch_ops.length), // Skip to next condition
                            ...this_branch_ops,                            
                            )

                        break
                }
            }
            const res = [
                ...conditionals.map((op, index) => {
                    if (op === "skip to finally") {
                        return ow.offsetOpCursor({offset: conditionals.length - index, fwd: true})
                    } else {
                        return op
                    }
                }),
                ...fin
            ]
            context.pop()
            return res
        }

        case "Noop": 
            return [ow.noop]
        case "None":
            return [ow.instantiate(null)]

        case "ArrayForEach":
            // Row variable is saved as well
            context.push()
            context.add(n.arg)
            const loop: Op[] = [
                ow.popArray,
                ow.moveStackTopToHeap,
                ...n.do.flatMap(node => full_compiler(node, context)),
                ow.truncateHeap(context.pop()),
            ]
            loop.push(ow.offsetOpCursor({offset: loop.length + 4, fwd: false}))
            return [
                ...full_compiler(n.target, context),
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
                    ...full_compiler(v, context),
                    ow.arrayPush
                )
            })
            return arr

        case "Keys":
            return [
                ...full_compiler(n.from, context),
                ow.getKeys
            ]

        case "GetType":
            return [
                ...full_compiler(n.value, context),
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
                    ...full_compiler(n.state, context),
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
                ...full_compiler(n.value, context),
                ow.negatePrev
            ]
        case "Is":
            return [
                ...full_compiler(n.value, context),
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
