import { ParseResult, executable, ASTKinds, func, expression, literal } from "./parser";
import {AnyNode, PickNode, FunctionDescription, GlobalObject, Manifest, ValueNode, FunctionData} from "conder_core"

type ScopeMapEntry= "func" | "global" | {kind: "const" | "mut", index: number}
class ScopeMap extends Map<string, ScopeMapEntry>  {
    nextVar: number = 0
    
    public get nextVariableIndex(): number {
        return this.nextVar
    }

    set(k: string, v: ScopeMapEntry): this {
        if (v !== "global" && v !== "func") {
            this.nextVar++
        }
        super.set(k, v)
        return this
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

function method_to_node(target: PickNode<"Saved" | "GlobalObject">, methods: expression["methods"], scope: ScopeMap): AnyNode {
    if (methods.length === 0) {
        return target
    }
    const fields: PickNode<"Selection">["level"] = []
    methods.forEach(m => {
        switch(m.method.kind) {
            case ASTKinds.literalIndex: 
                fields.push({kind: "String", value: m.method.value.name})
        
                break
            case ASTKinds.parameterIndex:
                const e = expression_to_node(m.method.value, scope)
                fields.push(only(e, "String", "Saved"))
                break

            default: 
                const n: never = m.method
        }
    })
    
    return {
        kind: "Selection",
        root: target,
        level: fields
    }
}

type Target = {root: PickNode<"Update">["root"], level: PickNode<"Update">["level"]}
function expression_to_update_target(exp: expression, scope: ScopeMap): Target {

    switch (exp.root.kind) {
        case ASTKinds.name:
            const name = scope.get(exp.root.name)
            if (name === undefined) {
                throw Error(`Unrecognized name ${exp.root.name}`)
            }
            if (name === "func") {
                throw Error(`Invalid function reference ${exp.root.name}`)
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
                        return only(expression_to_node(m.method.value, scope), "String", "Saved")
                    default: 
                        const n: never = m.method
              }
            })
            return {root, level}


        default: throw Error(`Invalid assignment to ${exp.root.kind}`)
    }
}

function expression_to_node(exp: expression, scope: ScopeMap): AnyNode {
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
            const name = scope.get(exp.root.name)
            if (name === undefined) {
                throw Error(`Unrecognized name ${exp.root.name}`)
            }
            if (name === "func") {
                throw Error(`Invalid function reference ${exp.root.name}`)
            } else if (name === "global") {
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
                    value: e.value.value !== null ? to_value_node(expression_to_node(e.value.value.exp, scope)) : undefined
                    }
                )
                break
            

            case ASTKinds.assignment: {
                const target: Target = expression_to_update_target(e.value.target, scope)
                // This needs to also accept mutations
                const value: PickNode<"Update">["operation"] = to_value_node(expression_to_node(e.value.value, scope))
                
                ret.push({
                    kind: "Update",
                    root: target.root,
                    level: target.level,
                    operation: value
                })
                break
            }
            case ASTKinds.expression: {
                cbOnly(expression_to_node(e.value, scope), ret.push, "Return", "If", "Save", "Update")
                
                break
            }

            case ASTKinds.varDecl: 
                const value = to_value_node(expression_to_node(e.value.value, scope))
                const index = scope.nextVariableIndex
                if (scope.has(e.value.name.name)) {
                    throw Error(`The symbol ${e.value.name.name} is already in use`)
                }
                scope.set(e.value.name.name, {kind: e.value.mutability === "const" ? "const" : "mut", index})
                ret.push({
                    kind: "Save",
                    value,
                })
                break
            default: 
                const n: never = e.value
        }
    })
    return ret
}

function to_descr(f: func, scope: ScopeMap): FunctionDescription {
    try {
        const argList: string[] = []
        if (f.args.leadingArgs.length > 0) {
            argList.push(...f.args.leadingArgs.map(a => a.name.name))
        }
        if (f.args.lastArg) {
            argList.push(f.args.lastArg.name)
        }
        const input: FunctionDescription["input"] = []
        argList.forEach((a, i) => {
            if (scope.has(a)) {
                throw Error(`Arg ${a} is using a name already in use`)
            }
            scope.set(a, {kind: "mut", index: i})
            input.push({kind: "Any", data: undefined})
        })
        
        return new FunctionDescription({
            input,
            computation: to_computation(f.body, scope)
        })
    } catch(e) {
        throw Error(`In function ${f.name.name}: \n\t${e.message}`)
    }
    
}

export function semantify(p: ParseResult): Manifest {
    if (p.err) {
        throw Error(`Failure parsing: line ${p.err.pos.line} col ${p.err.pos.offset}: ${p.err.toString()}`)
    }

    const globalScope = new ScopeMap()
    const aFunc: func[] = []

    const funcs: Map<string, FunctionDescription> = new Map()
    const globs: Map<string, GlobalObject> = new Map()

    p.ast.forEach(g => {
        const name = g.value.name.name
        if (globalScope.has(name)) {
            throw Error(`Another global or function is already called ${name}`)
        }
        
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
            default: 
                const ne: never = g.value
        }
    })


    aFunc.forEach(f => funcs.set(f.name.name, to_descr(f, globalScope)))

    return  {
        globals: globs,
        funcs
    }


}