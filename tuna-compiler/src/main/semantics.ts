import { MathExpression, MathInfix, Ordering, AnyInfix } from './math';
import { ParseResult, executable, ASTKinds, func, expression, literal, infixOps_$0, methodInvoke, schema, someType } from "./parser";
import {AnyNode, PickNode, FunctionDescription, GlobalObject, Manifest, ValueNode, FunctionData} from "conder_core"
// Export this at the root level
import { AnySchemaInstance, schemaFactory } from 'conder_core/dist/src/main/ops';

type ScopeMapEntry= "func" | 
"global" | 
{kind: "const", index: number} |
{kind: "mut", index: number} | 
{kind: "typeAlias", value: AnySchemaInstance}

type EntityKind = Extract<ScopeMapEntry, {kind: any}>["kind"] | Exclude<ScopeMapEntry, {kind: any}>
type Entry<K extends EntityKind> = Extract<ScopeMapEntry, K> extends never ? Extract<ScopeMapEntry, {kind: K}> : K
type PickEnt<K extends EntityKind> =  {
    [E in K]: Entry<E>
}[K]

class ScopeMap extends Map<string, ScopeMapEntry>  {
    private nextVar: number = 0
    private scopes: Set<string>[] = [new Set()]
    
    public get nextVariableIndex(): number {
        return this.nextVar
    }

    getKind<S extends EntityKind>(key: string, ...kinds: S[]): PickEnt<S> {
        const obj = this.get(key)
        if (obj === undefined) {
            throw Error(`No such entity in scope: ${key}`)
        }
        switch (obj) {
            case "func":
            case "global":
                //@ts-ignore
                if (kinds.includes(obj)) {
                    return obj as any
                }
                break
            default:
                //@ts-ignore
                if (kinds.includes(obj.kind)) {
                    return obj as any
                }
                break
        }
        throw Error(`Expected one of ${kinds} but found ${JSON.stringify(obj)}`)
        
    }

    set(k: string, v: ScopeMapEntry): this {
        if (v !== "global" && v !== "func") {
            this.nextVar++
        }
        if (this.has(k)) {
            throw Error(`The name ${k} is initialized to multiple variables/functions.`)
        }
        super.set(k, v)
        const this_scope = this.scopes.pop()
        this_scope.add(k)
        this.scopes.push(this_scope)
        return this
    }
    pushScope() {
        this.scopes.push(new Set())
    }

    popScope() {
        const popped = this.scopes.pop()
        popped.forEach(v => {
            this.delete(v)
        })
        this.nextVar = this.nextVar - popped.size
    }

}


function excluding<EX extends AnyNode["kind"], IN extends AnyNode["kind"]>(node: PickNode<IN>, ...not: EX[]): Exclude<PickNode<IN>, {kind: EX}> {
    //@ts-ignore
    if (not.includes(node.kind)) {
        throw Error(`Invalid expression ${node.kind}`)
    }
    //@ts-ignore
    return node
}
function only<IN extends AnyNode["kind"]>(node: AnyNode, ...only: IN[]): Extract<AnyNode, {kind: IN}> {
    //@ts-ignore
    if (only.includes(node.kind)) {
        //@ts-ignore
        return node
    }

    throw Error(`Invalid expression ${node.kind}`)
}

function cbOnly<IN extends AnyNode["kind"]>(node: AnyNode, f: (i: PickNode<IN>) => void, ...only: IN[]) {
    //@ts-ignore
    if (only.includes(node.kind)) {
        //@ts-ignore
        f(node)
    }
}

function to_value_node(n: AnyNode): ValueNode {
    return excluding(n,  
        "ArrayForEach", 
        "Update", 
        "Return", 
        "If", 
        "Save", 
        "DeleteField", 
        "Field", 
        "Finally", 
        "Else", 
        "Noop", 
        "Push",
        "Conditional"
        )
}


function literal_to_node(lit: literal, scope: ScopeMap): ValueNode {
    switch (lit.kind) {
        case ASTKinds.bool:
            return {kind: "Bool", value: lit.value === "true"}
        case ASTKinds.obj:
            
            return {
                kind: "Object", 
                fields: lit.fields.value.map(f => {
                
                    return {
                        kind: "Field", 
                        key: {kind: "String", value: f.name.name}, 
                        value: literal_to_node(f.value, scope)
                    }
                })
            }
        case ASTKinds.str:
            return {
                kind: "String",
                value: lit.value
            }
        case ASTKinds.num:    
            return {
                kind: "Int",
                value: parseFloat(lit.value)
            }
    }
}

type IsMutation = "Push"
type aaa = "Push"
type BakedInMethods = PickNode<"Push"> | PickNode<"Keys">
type MethodCompiler<P extends BakedInMethods["kind"]> = 
    (current: PickNode<"Selection">, invoke: methodInvoke, scope: ScopeMap) => P extends IsMutation ? PickNode<"Update"> : PickNode<P>
type MethodLookup = {
    [P in BakedInMethods["kind"]]: MethodCompiler<P>
}

const baked_in_methods: MethodLookup = {
    Keys: (current, invoke, scope) => {
        
        if (invoke.args.lastArg|| invoke.args.leadingArgs.length > 0) {
            throw Error(`keys should be called with zero args.`)
        }
        
        return {
            kind: "Keys",
            target: current.level.length === 0 ? current.root : {
                kind: "Selection",
                level: current.level,
                root: current.root
            }
        }
    },
    Push: (current, invoke, scope) => {
        if (invoke.args.lastArg == undefined) {
            throw Error(`Push requires at least one argument`)
        }

        const args = [...invoke.args.leadingArgs.map(a => a.value), invoke.args.lastArg]
        
        return {
            kind: "Update",
            root: current.root,
            level: current.level,
            operation: {
                kind: "Push",
                values: args.map(arg => complete_expression_to_node(arg, scope)).map(to_value_node)
            }
        }
        
    }
}


function method_to_node(target: PickNode<"Saved" | "GlobalObject">, methods: expression["methods"], scope: ScopeMap): AnyNode {
    if (methods.length === 0) {
        return target
    }
    let current: PickNode<"Selection"> = {
        kind: "Selection",
        level: [],
        root: target
    }
    
    for (let i = 0; i < methods.length; i++) {
        const m = methods[i];
        switch(m.method.kind) {
            case ASTKinds.literalIndex: 
                current.level.push({kind: "String", value: m.method.value.name})
        
                break
            case ASTKinds.parameterIndex:
                const e = complete_expression_to_node(m.method.value, scope)
                current.level.push(to_value_node(e))
                break

            case ASTKinds.methodInvoke: 
                const capitalized = `${m.method.name.name[0].toUpperCase()}${m.method.name.name.slice(1)}`
                if (capitalized in baked_in_methods) {
                    const res = baked_in_methods[capitalized as keyof MethodLookup](current, m.method, scope)
                    if (res.kind === "Update" && i !== methods.length - 1) {
                        throw Error(`Mutations do not return results`)
                    }
                    if (res.kind === "Keys") {
                        if (i !== methods.length - 1) {
                            throw Error("Currently cannot index directly into keys result")
                        }
                        return res
                    }
                    return res
                } else {
                    throw Error(`Unrecognized method ${m.method.name.name}`)
                }
                
            default: 
                const n: never = m.method
        }
    }
    
    return current
}

type Target = {root: PickNode<"Update">["root"], level: PickNode<"Update">["level"]}
function expression_to_update_target(exp: expression, scope: ScopeMap): Target {

    switch (exp.root.kind) {
        case ASTKinds.name:
            const name = scope.getKind(exp.root.name, "mut", "const", "global")
            if (name === undefined) {
                throw Error(`Unrecognized name ${exp.root.name}`)
            }
            
            if (name !== "global" && name.kind === "const") {
                throw Error(`Attempting to overwrite constant variable ${exp.root.name}`)
            }
            
            const root: Target["root"] = name === "global" ? 
                {kind: "GlobalObject", name: exp.root.name} 
                : {kind: "Saved", index: name.index}
            
            const level: Target["level"] = exp.methods.map(m => {
                switch (m.method.kind) {
                    case ASTKinds.literalIndex:
                        return {
                            kind: "String",
                            value: m.method.value.name
                        }
                        
                    case ASTKinds.parameterIndex:
                        return to_value_node(complete_expression_to_node(m.method.value, scope))

                    case ASTKinds.methodInvoke:
                        throw Error(`Cannot update the temporary value returned from a function`)

                    default: 
                        const n: never = m.method
              }
            })
            return {root, level} 


        default: throw Error(`Invalid assignment to ${exp.root.kind}`)
    }
}

const signToConder: Record<infixOps_$0["kind"], AnyInfix> = {
    "minus": "-",
    "plus": "+",
    "mult": "*",
    "divide": "/",
    "eq": "==",
    "geq": ">=",
    "gt": '>',
    "lt": "<",
    "neq": "!=",
    "leq": "<=",
    "and": "and",
    "or": "or"
}

function get_all_infix(exp: expression): [AnyInfix, expression][]{
    if (exp.infix != undefined) {
        return [[signToConder[exp.infix.sign.op.kind], exp.infix.arg], ...get_all_infix(exp.infix.arg)]
    } else {
        return []
    }
}

function complete_expression_to_node(root_exp: expression, scope: ScopeMap): AnyNode {
    const infixes = get_all_infix(root_exp)
    const root = expression_to_node(root_exp, scope)
    if (root.kind === "Update") {
        if (infixes.length > 0) {
            throw Error(`Mutations do not return any results`)
        }
        return root
    }
    let entirity: MathExpression = new Ordering(excluding(to_value_node(root), "GlobalObject"))
    infixes.forEach(([sign, exp]) => {
        entirity = entirity.then(sign, excluding(to_value_node(expression_to_node(exp, scope)), "GlobalObject"))
    })
    
    return entirity.build()
}

// Does not evaluate infix operators
function expression_to_node(exp: expression, scope: ScopeMap): AnyNode {
    if (exp.prefix) {
        const prefix = exp.prefix.op.kind
        exp.prefix = undefined
        switch (prefix) {
            case ASTKinds.not:
                // Eventually make a not operator so none can be falsy too
                return {
                    kind: "Comparison",
                    left: to_value_node(complete_expression_to_node(exp, scope)),
                    right: {kind: "Bool", value: false},
                    sign: "=="
                }

            case ASTKinds.minus: 
                return {
                    kind: "Math",
                    left: excluding(to_value_node(complete_expression_to_node(exp, scope)), "GlobalObject"),
                    right: {kind: "Int", value: -1},
                    sign: "*"
                }

            default: 
                const n: never = prefix
        }
    }

    switch(exp.root.kind) {
        case ASTKinds.bool:
        case ASTKinds.str:
        case ASTKinds.num:
        case ASTKinds.obj:
            if (exp.methods.length > 0) {
                throw Error(`Unexpected method on ${exp.root.kind} literal`)
            }
            return only(literal_to_node(exp.root, scope), "Bool", "Int", "String", "Object")
            
        
        case ASTKinds.name:
            const name = scope.getKind(exp.root.name, "global", "const", "mut")
            
            if (name === "global") {
                return method_to_node({kind: "GlobalObject", name: exp.root.name}, exp.methods, scope)
            } else {
                return method_to_node({kind: "Saved", index: name.index}, exp.methods, scope)
            }
        default: 
            const n: never = exp.root
    }
}


function to_computation(ex: executable, scope: ScopeMap): FunctionData["computation"] {
    const ret: FunctionDescription["computation"] = []
    ex.value.forEach(e => {
        
        switch (e.value.kind) {
            case ASTKinds.ret:
                ret.push({
                    kind: "Return", 
                    value: e.value.value !== null ? to_value_node(complete_expression_to_node(e.value.value.exp, scope)) : undefined
                    }
                )
                break
            

            case ASTKinds.assignment: {
                const target: Target = expression_to_update_target(e.value.target, scope)
                // This needs to also accept mutations
                const value: PickNode<"Update">["operation"] = to_value_node(complete_expression_to_node(e.value.value, scope))
                
                ret.push({
                    kind: "Update",
                    root: target.root,
                    level: target.level,
                    operation: value
                })
                break
            }
            case ASTKinds.expression: {
                cbOnly(complete_expression_to_node(e.value, scope), (...items) => ret.push(...items), "Return", "If", "Save", "Update")
                
                break
            }

            case ASTKinds.varDecl: 
                const value = to_value_node(complete_expression_to_node(e.value.value, scope))
                const index = scope.nextVariableIndex
                scope.set(e.value.name.name, {kind: e.value.mutability === "const" ? "const" : "mut", index})
                ret.push({
                    kind: "Save",
                    value,
                })
                break

            case ASTKinds.functionCall:
                if (e.value.name.name !== "delete") {
                    throw Error(`At the moment, you can only call the delete() function.`)
                }
                if (e.value.args.leadingArgs.length !== 0 || e.value.args.lastArg == undefined) {
                    throw Error(`Delete expects one argument`)
                }
                const {root, level} = expression_to_update_target(e.value.args.lastArg, scope)
                if (level.length === 0) {
                    throw Error(`Delete cannot be applied to whole variables`)
                }
                ret.push({
                    kind: "Update",
                    root,
                    level,
                    operation: {
                        kind: "DeleteField"
                    }
                })
                break

            case ASTKinds.forLoop:
                scope.pushScope()
                const rowVar = scope.nextVariableIndex
                scope.set(e.value.rowVar.name, {kind: "const", index: rowVar})
                const loopDo = to_computation(e.value.do.body, scope)
                const target = to_value_node(complete_expression_to_node(e.value.value, scope))
                ret.push({
                    kind: 'ArrayForEach',
                    do: loopDo,
                    target
                })
                scope.popScope()
                
                break

            case ASTKinds.ifs:
                scope.pushScope()
                const this_if: PickNode<"If"> = {
                    kind: "If",
                    conditionally:  [{
                        kind: "Conditional",
                        do: to_computation(e.value.if_this.do.body, scope),
                        cond: to_value_node(complete_expression_to_node(e.value.if_this.cond, scope))
                    }]
                }
                scope.popScope()

                e.value.elifs.forEach(elif => {
                    scope.pushScope()
                    this_if.conditionally.push({
                        kind: "Conditional",
                        do: to_computation(elif.else_this.do.body, scope),
                        cond: to_value_node(complete_expression_to_node(elif.else_this.cond, scope))
                    })
                    scope.popScope()
                })
                scope.pushScope()
                if (e.value.otherwise) {
                    this_if.conditionally.push({
                        kind: "Else",
                        do: to_computation(e.value.otherwise.do.body, scope)
                    })
                }
                scope.popScope()
                ret.push(this_if)
                
                break
            default: 
                const n: never = e.value
        }
    })
    return ret
}

function parsed_to_schema(schema: someType): AnySchemaInstance {
    const getInner: () => AnySchemaInstance = () =>  {
        switch(schema.type.kind) {
            case ASTKinds.str_t:
                return schemaFactory.string
            case ASTKinds.int_t:
                return schemaFactory.int
            case ASTKinds.double_t:
                return schemaFactory.double
            case ASTKinds.bool_t:
                return schemaFactory.bool
            case ASTKinds.any_t:
                return schemaFactory.Any
            case ASTKinds.object_t:
                const obj: Record<string, AnySchemaInstance> = {}
                schema.type.fields.forEach(field => {
                    obj[field.name.name] = parsed_to_schema(field.schema)
                })
                return schemaFactory.Object(obj)
            default: const n: never = schema.type
        }
    }
    return schema.asArray ? schemaFactory.Array(getInner()) : getInner()
}

function to_descr(f: func, scope: ScopeMap, debug: boolean): FunctionDescription {
    try {
        const argList: {name: string, schema?: schema}[] = []
        if (f.params.leadingParams.length > 0) {
            argList.push(...f.params.leadingParams.map(a => ({name: a.name.name, schema: a.schema})))
        }
        if (f.params.lastParam) {
            argList.push({name: f.params.lastParam.name.name, schema: f.params.lastParam.schema})
        }
        const input: FunctionDescription["input"] = []
        argList.forEach((a, i) => {
            scope.set(a.name, {kind: "mut", index: i})
            if (a.schema) {
                const inner = a.schema.type.kind === ASTKinds.name ? 
                    scope.getKind(a.schema.type.name, "typeAlias").value :
                    parsed_to_schema(a.schema.type)
                input.push(a.schema.asArray ? schemaFactory.Array(inner) : inner)
            } else {
                input.push({kind: "Any", data: undefined})
            }
        })
        
        return new FunctionDescription({
            input,
            computation: to_computation(f.body.body, scope)
        })
    } catch(e) {
        throw Error(`In function ${f.name.name}: \n\t${e.message}${debug ? `\n\n${e.stack}` : ''}`)
    }
    
}

export function semantify(p: ParseResult, debug: boolean): Manifest {
    if (p.err) {
        throw Error(`Failure parsing: line ${p.err.pos.line} col ${p.err.pos.offset}: ${p.err.toString()}`)
    }

    const globalScope = new ScopeMap()
    const aFunc: func[] = []

    const funcs: Map<string, FunctionDescription> = new Map()
    const globs: Map<string, GlobalObject> = new Map()

    p.ast.forEach(g => {
        switch (g.value.kind) {
            case ASTKinds.typeDef:
                globalScope.set(g.value.name.name, {kind: "typeAlias", value: parsed_to_schema(g.value.def)})
        }
    })

    p.ast.forEach(g => {
        const name = g.value.name.name
        
        switch (g.value.kind) {
        
            case ASTKinds.varDecl: 
                if (g.value.mutability !== "const") {
                    throw Error(`Global variable ${name} must be const`)
                }
                
                switch (g.value.value.root.kind) {
                    case ASTKinds.obj: 
                        if (g.value.value.root.fields.value.length > 0) {
                            break
                        }
                        if (g.value.value.methods.length > 0) {
                            break
                        }
                        globalScope.set(name, "global")
                        globs.set(name, {kind: "glob", name})
                        return
                    default: 
                        break
                }

                throw Error(`Global ${name} must be initialized as empty object`)
                
            case ASTKinds.func: 
                globalScope.set(name, "func")
                aFunc.push(g.value)
                break
            case ASTKinds.typeDef:
                break
            default: 
                const ne: never = g.value
        }
    })


    aFunc.forEach(f => {
        globalScope.pushScope()
        funcs.set(f.name.name, to_descr(f, globalScope, debug))
        globalScope.popScope()
    })

    return  {
        globals: globs,
        funcs
    }


}