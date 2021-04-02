import { Op } from '../ops/bindings';
import { ow, Utils } from '../ops/index';
import { FunctionDescription } from './function';
import { AnyNode, PickNode} from './IR';
import { IVariableResolver } from './variable_resolution';


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
function create_well_formed_branch(n: PickNode<"If">): PickNode<"If">["conditionally"] {
    const wellFormed: PickNode<"If">["conditionally"] = []
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
export function base_compiler(n: AnyNode, context: IVariableResolver): Op[] {
    switch (n.kind) {
        case "Bool":
        case "Int":
        case "String":
            
            return [ow.instantiate(n.value)]

        case "Math":
            return [
                ...base_compiler(n.left, context),
                ...base_compiler(n.right, context),
                ...mathLookup[n.sign]
            ]

        case "BoolAlg":
            return [
                ...base_compiler(n.left, context),
                ...base_compiler(n.right, context),
                ...boolAlg[n.sign]
            ]

        case "Comparison":
            return [
                ...base_compiler(n.left, context),
                ...base_compiler(n.right, context),
                ...comparisonLookup[n.sign]
            ]
        case "FieldExists":
            
            return [
                ...base_compiler(n.value, context),
                ...base_compiler(n.field, context),
                ow.fieldExists
            ]

        case "Object":
            return [
                ow.instantiate({}),
                ...n.fields.flatMap((node) => base_compiler(node, context))
            ]

        case "Return":
            return n.value ? [
                ...base_compiler(n.value, context),
                ow.returnStackTop
            ] : [
                ow.returnVoid
            ]
        case "Call":       
            return [
                ...n.args.flatMap(node => base_compiler(node, context)),
                ow.invoke({name: n.function_name, args: n.args.length})
            ]
        
        case "Save":
            context.add(n.name)
            return [...base_compiler(n.value, context), ow.moveStackTopToHeap]
        case "Saved":
            return [ow.copyFromHeap(context.get(n))]
        
        case "Field":
            return [
                ...base_compiler(n.key, context),                
                ...base_compiler(n.value, context),
                ow.setField({field_depth: 1})
            ]

        case "Update":
            
            switch (n.operation.kind) {
                case "Push": 
                    if (n.level.length > 0) {
                        return [
                            ...n.level.flatMap(node => base_compiler(node, context)),
                            ow.instantiate([]),
                            ...n.operation.values.flatMap(v => [...base_compiler(v, context), ow.arrayPush]),
                            ow.pushSavedField({field_depth: n.level.length, index: context.get(n.root)})
                        ]

                    } else {
                        return n.operation.values.flatMap(v => {
                            return [
                                ...base_compiler(v, context),
                                ow.moveStackToHeapArray(context.get(n.root))
                            ]
                        })
                    }

                case "DeleteField":
                    
                    return [
                        ...n.level.flatMap(node => base_compiler(node, context)),
                        ow.deleteSavedField({field_depth: n.level.length, index: context.get(n.root)}),
                    ]
                    
                default:
                    if (n.level.length === 0) {
                        return [
                            ...base_compiler(n.operation, context),
                            ow.overwriteHeap(context.get(n.root))
                        ]
                    }
                    return [
                        ...n.level.flatMap(node => base_compiler(node, context)),
                        ...base_compiler(n.operation, context),                        
                        ow.setSavedField({field_depth: n.level.length, index: context.get(n.root)}),
                    ]
            }
        case "Selection":
            if (n.level.length > 0) {
                return [
                    ...base_compiler(n.root, context),
                    ...n.level.flatMap(node => base_compiler(node, context)),
                    ow.getField({field_depth: n.level.length})
                ]
            } else {
                return base_compiler(n.root, context)
            }
            
        case "If":{
            context.push()
            const wellFormed = create_well_formed_branch(n)
            const fin = wellFormed.pop().do.flatMap(node => base_compiler(node, context))
            const first_to_last = wellFormed.reverse()
            const conditionals: (Op | "skip to finally")[] = []
            while (first_to_last.length > 0) {
                const this_branch = wellFormed.pop()
                const num_vars_in_branch = this_branch.do.filter(k => k.kind === "Save").length
                const drop_vars = num_vars_in_branch > 0 ? [ow.truncateHeap(num_vars_in_branch)] : []

                const this_branch_ops: (Op | "skip to finally")[] = [
                    ...this_branch.do.flatMap(node => base_compiler(node, context)), // do this
                    ...drop_vars,
                    "skip to finally" // then skip to finally,
                ]

                switch (this_branch.kind) {
                    case "Else":
                        conditionals.push(...this_branch_ops)
                        break
                    case "Conditional":
                        conditionals.push(
                            ...base_compiler(this_branch.cond, context),
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
                ...n.do.flatMap(node => base_compiler(node, context)),
                ow.truncateHeap(context.pop()),
            ]
            loop.push(ow.offsetOpCursor({offset: loop.length + 4, fwd: false}))
            return [
                ...base_compiler(n.target, context),
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
                    ...base_compiler(v, context),
                    ow.arrayPush
                )
            })
            return arr

        case "Keys":
            return [
                ...base_compiler(n.from, context),
                ow.getKeys
            ]

        case "GetType":
            return [
                ...base_compiler(n.value, context),
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
                    ...base_compiler(n.state, context),
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
                ...base_compiler(n.value, context),
                ow.negatePrev
            ]
        case "Is":
            return [
                ...base_compiler(n.value, context),
                ow.stackTopMatches({schema: n.type})
            ]
        case "GlobalObject":
            return []
        case "Push":
        case "Conditional":
        case "Finally":
        case "Else":
        case "DeleteField":
        
            throw Error(`${n.kind} should be compiled within parent`)
        default: Utils.assertNever(n)
    }
}
