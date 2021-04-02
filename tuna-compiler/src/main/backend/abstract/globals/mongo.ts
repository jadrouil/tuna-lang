
import { Op, ow } from '../../ops/index';
import { AnyNode, make_replacer, Node, PickTargetNode, RequiredReplacer, TargetNodeSet, ValueNode, Key } from '../IR';
import { base_compiler, Compiler, Transform, Transformer } from '../compilers';
import { FunctionDescription } from '../function';
import { IVariableResolver, VarResolver } from '../variable_resolution';

type TargetKeys = PickTargetNode<MongoNodeSet, "Selection">["level"]
type AnyValue = PickTargetNode<MongoNodeSet, Exclude<ValueNode["kind"], "GlobalObject">>
export type MongoNodeSet = {
    GetWholeObject: Node<{name: string}>,
    GetKeyFromObject: Node<{obj: string, key: TargetKeys}>
    keyExists: Node<{obj: string, key: TargetKeys[0]}>
    SetKeyOnObject: Node<{obj: string, key: TargetKeys, value: AnyValue}>,
    DeleteKeyOnObject: Node<{obj: string, key: TargetKeys}>
    GetKeysOnly: Node<{obj: string}>
    PushAtKeyOnObject: Node<{obj: string, key: TargetKeys, values: AnyValue[]}>
}

const MONGO_REPLACER: RequiredReplacer<MongoNodeSet> = {
    Keys(n, r) {
        if (n.from.kind === "GlobalObject") {
            return {
                kind: "GetKeysOnly",
                obj: n.from.name
            }
        }
        return {kind: "Keys", from: r(n.from)}
    },
    GetType(n, r) {
        return {kind: "GetType", value: r(n.value)}
    },
    Is(n, r) {
        return {kind: "Is", value: r(n.value), type: n.type}
    },
    Not(n, r) {
        return {kind: 'Not', value: r(n.value)}
    },
    RoleInstance(n, r) {
        return {
            kind: "RoleInstance",
            role: n.role,
            state: n.state ? r(n.state) : undefined
        }
    },
    If(n, r) {
        return {
            kind: "If",
            conditionally: n.conditionally.map(r)
        }
    },

    Call(n, r) {
        return {
            kind: "Call",
            function_name: n.function_name,
            args: n.args.map(r)
        }
    },

    Else(n, r) {
        return {kind: "Else", do: n.do.map(r)}
    },
    Finally(n, r) {
        return {kind: "Finally", do: n.do.map(r)}
    },

    Field(n, r) {
        return {kind: "Field", key: n.key, value: r(n.value)}
    },

    Push(n, r) {
        return {
            kind: "Push", values: n.values.map(v => {
                if (v.kind === "GlobalObject") {
                    throw Error(`Cannot use global object in a push`)
                }
                return r(v)
            })
        }
    },

    ArrayLiteral(n, r) {
        return {
            kind: "ArrayLiteral",
            values: n.values.map(v => {
                if (v.kind === "GlobalObject") {
                    throw Error(`Cannot use global object in array literal`)
                }
                return r(v)
            })
        }
    },

    ArrayForEach(n, r) {
        return {kind: "ArrayForEach", do: n.do.map(r), target: r(n.target), arg: n.arg}
    },
    Conditional(n, r) {
        return {kind: "Conditional", cond: r(n.cond), do: n.do.map(r)}
    },

    Comparison(n, r) {
        return {
            kind: "Comparison",
            left: r(n.left),
            right: r(n.right),
            sign: n.sign
        }
    },

    BoolAlg(n, r) {
        return {
            kind: "BoolAlg",
            left: r(n.left),
            right: r(n.right),
            sign: n.sign
        }
    },

    Math(n, r) {
        return {
            kind: "Math",
            sign: n.sign,
            left: r(n.left),
            right: r(n.right)
        }
    },

    Object(n, r) {
        return {
            kind: "Object",
            fields: n.fields.map(f => r(f))
        }
    },

    Return(n, r) {
        return {
            kind: "Return",
            value: n.value ? r(n.value) : undefined
        }
    },

    Save(n, r) {
        
        return {
            kind: "Save",
            name: n.name,
            value: r(n.value)
        }
    },
    

    Selection(n, r) {
        switch (n.root.kind) {
            case "GlobalObject":
                if (n.level.length > 0) {
                    if (n.level[0].kind === "Keys") {
                        return {
                            kind: "Selection",
                            root: {
                                kind: "GetKeysOnly",
                                obj: n.root.name
                            },
                            level: n.level.slice(1).map(r)
                        }
                    }
                    return {
                        kind: "GetKeyFromObject",
                        obj: n.root.name,
                        key: n.level.map(r)
                    }
                } else {                     
                    return {
                        kind: "GetWholeObject",
                        name: n.root.name
                    }
                }
                
            default: 
                return {
                    kind: "Selection",
                    root: r(n.root),
                    level: n.level.map(r)
                }
            
        }
    },
    FieldExists(n, r) {
    
        switch (n.value.kind) {
            case "GlobalObject":
                return {
                    kind: "keyExists",
                    obj: n.value.name,
                    key: r(n.field)
                }
        }
        
        return {
            kind: "FieldExists",
            value: r(n.value),
            field: r(n.field)
        }
    },
    Update(n, r) {

        switch (n.root.kind) {
            case "GlobalObject":
                switch (n.operation.kind) {
                    case "Push":
                        return {
                            kind: "PushAtKeyOnObject",
                            obj: n.root.name,
                            values: n.operation.values.map(r),
                            key: n.level.map(r)
                        }

                    case "DeleteField":
                        return {
                            kind: "DeleteKeyOnObject",
                            obj: n.root.name,
                            key: n.level.map(r)
                        }
                    
                    default: 
                        return {
                            kind: "SetKeyOnObject",
                            obj: n.root.name,
                            key: n.level.map(r),
                            value: r(n.operation)
                        }
                }

        }
        
        
        return {
            kind: "Update",
            root: n.root,
            level: n.level.map(r),
            operation: r(n.operation)
        }
    },
}
const complete_replace = make_replacer(MONGO_REPLACER) 
export const MONGO_GLOBAL_ABSTRACTION_REMOVAL: Transform<   
    Map<string, FunctionDescription>, 
    Map<string, FunctionDescription<TargetNodeSet<MongoNodeSet>>>> = Transformer.Map((func) => func.apply(f => [complete_replace(f)]))

type MongoCompiler = Compiler<TargetNodeSet<MongoNodeSet>>

function compile_function(n: TargetNodeSet<MongoNodeSet>, args: IVariableResolver): Op[] {
    switch (n.kind) {
        case "GetWholeObject": 
            return [
                ow.getAllFromStore(n.name),
                ow.repackageCollection
            ]
        
        
        case "GetKeyFromObject":
            const manyKeySuccess: Op[] = []
            const manyKeyFail: Op[] = []
            if (n.key.length > 1) {
                manyKeySuccess.push(
                    ...n.key.slice(1).flatMap(node => compile_function(node, args)),
                    ow.getField({field_depth: n.key.length - 1})
                )

                manyKeyFail.push(ow.raiseError("Key does not exist on global"))
            }
            return [
                // Create the query doc
                ow.instantiate({_key: {}}),
                // Search for key
                ow.instantiate("_key"),
                ...compile_function(n.key[0], args),
                ow.setField({field_depth: 1}),
                ow.findOneInStore([n.obj, {}]),
                ow.isLastNone,
                ow.conditonallySkipXops(1 + manyKeySuccess.length + manyKeyFail.length),
                ow.tryGetField("_val"),
                ...manyKeySuccess,
                ow.offsetOpCursor({offset: manyKeyFail.length + 1, fwd: true}),
                ...manyKeyFail,
                ow.instantiate(null)
            ]
        case "PushAtKeyOnObject": {
            const updateDocumentCreation: Op[] = []
            if (n.key.length > 1) {
                updateDocumentCreation.push(
                    //The query doc
                    ow.instantiate({"$push": {}}),
                    // Move the each doc into the query doc.
                    ow.instantiate("$push"),
                        ow.instantiate("_val"),
                        ...n.key.slice(1).flatMap(node => compile_function(node, args)),
                        ow.stringConcat({nStrings: n.key.length, joiner: "."}),
                            // Creates an {each: [value]} doc
                            ow.instantiate({}),
                            ow.instantiate("$each"),
                            ow.instantiate([]),
                            ...n.values.flatMap(v => [...compile_function(v, args), ow.arrayPush]),
                            ow.setField({field_depth: 1}),
                    ow.setField({field_depth: 2})
                )
            } else {
                
                updateDocumentCreation.push( 
                    ow.instantiate({"$push": {_val: {}}}),
                    ow.instantiate("$push"),
                    ow.instantiate("_val"),
                    ow.instantiate("$each"),
                    ow.instantiate([]),
                    ...n.values.flatMap(v => [...compile_function(v, args), ow.arrayPush]),
                    ow.setField({field_depth: 3}),
                )
            }
            return [
                ...updateDocumentCreation,
                // Create the query doc
                ow.instantiate({_key: {}}),
                ow.instantiate("_key"),
                ...compile_function(n.key[0], args),
                ow.setField({field_depth: 1}),
                // update or insert key
                ow.updateOne({store: n.obj, upsert: n.key.length === 1}),
                ow.isLastNone,
                ow.conditonallySkipXops(2),
                ow.popStack,
                ow.offsetOpCursor({offset: 1, fwd: true}),
                ow.raiseError("Nested key does not exist"),
            ]
        }

            
        case "SetKeyOnObject":
            const updateDocumentCreation: Op[] = []
            if (n.key.length > 1) {
                updateDocumentCreation.push(
                    ow.instantiate({"$set": {}}),
                    ow.instantiate("$set"),
                    ow.instantiate("_val"),
                    ...n.key.slice(1).flatMap(node => compile_function(node, args)),
                    ow.stringConcat({nStrings: n.key.length, joiner: "."}),
                    ...compile_function(n.value, args),
                    ow.setField({field_depth: 2})
                )
            } else {
                updateDocumentCreation.push( 
                    ow.instantiate({"$set": {_val: {}}}),
                    ow.instantiate("$set"),
                    ow.instantiate("_val"),
                    ...compile_function(n.value, args),
                    ow.setField({field_depth: 2}),
                )
            }
            return [
                ...updateDocumentCreation,
                // Create the query doc
                ow.instantiate({_key: {}}),
                ow.instantiate("_key"),
                ...compile_function(n.key[0], args),
                ow.setField({field_depth: 1}),
                // update or insert key
                ow.updateOne({store: n.obj, upsert: n.key.length === 1}),
                ow.isLastNone,
                ow.conditonallySkipXops(2),
                ow.popStack,
                ow.offsetOpCursor({offset: 1, fwd: true}),
                ow.raiseError("Nested key does not exist"),
            ]
        
     
        case "keyExists":
            return [
                ow.instantiate({_key: {}}),
                // Search for key
                ow.instantiate("_key"),
                ...compile_function(n.key, args),
                ow.setField({field_depth: 1}),
                // We don't need the value, so just suppress it.
                ow.findOneInStore([n.obj, {_val: false}]),
                ow.isLastNone,
                ow.conditonallySkipXops(3),
                ow.popStack,
                ow.instantiate(true),
                ow.offsetOpCursor({offset: 2, fwd: true}),
                ow.popStack,
                ow.instantiate(false)
            ]
        

        case "DeleteKeyOnObject": {
            if (n.key.length > 1) {
                return [
                    ow.instantiate({"$unset": {}}),
                    ow.instantiate("$unset"),
                    ow.instantiate("_val"),
                    ...n.key.slice(1).flatMap(node => compile_function(node, args)),
                    ow.stringConcat({nStrings: n.key.length, joiner: "."}),
                    ow.instantiate(""),
                    ow.setField({field_depth: 2}),
                    ow.instantiate({_key: {}}),
                    ow.instantiate("_key"),
                    ...compile_function(n.key[0], args),
                    ow.setField({field_depth: 1}),
                    ow.updateOne({store: n.obj, upsert: false}),
                    ow.popStack
                ]
                    
            } else {
                return  [
                    ow.instantiate({_key: {}}),
                    ow.instantiate("_key"),
                    ...compile_function(n.key[0], args),
                    ow.setField({field_depth: 1}),
                    ow.deleteOneInStore(n.obj),
                    ow.popStack
                ]
            }
        }
        
        case "GetKeysOnly": {
            const collectKey = [
                ow.popArray,
                ow.instantiate("_key"),
                ow.getField({field_depth: 1}),
                ow.pArrayPush({stack_offset: 1}),
            ]
            
            const evalLength = [
                ow.ndArrayLen,
                ow.instantiate(0),
                ow.equal,
                ow.conditonallySkipXops(collectKey.length + 1) // jump past the collection and repetition.
            ]

            return [
                ow.instantiate([]), // Collect keys here
                ow.instantiate({}), // No filter conditions,
                ow.queryStore([n.obj, {_val: false}]), // supress the value
                ...evalLength,
                ...collectKey,
                ow.offsetOpCursor({offset: collectKey.length + evalLength.length, fwd: false}),
                ow.popStack
            ]
        }

            

        default: return base_compiler(n, compile_function, args)
    }
}

export const MONGO_COMPILER: MongoCompiler = Transformer.Map(fun => {
    const varResolver = new VarResolver()
    fun.input.forEach(i => varResolver.add(i.name))
    return new FunctionDescription({input: fun.input, computation: fun.computation.flatMap(n => compile_function(n, varResolver))})
})
