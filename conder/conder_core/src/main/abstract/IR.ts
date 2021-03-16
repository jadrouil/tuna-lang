import {Op, Schema, Utils } from '../ops/index';

export type Node<DATA={}, META extends "root" | "not root"="not root"> = DATA & {_meta: META}
export type ValueNode = PickNode<
    "Bool" | 
    "Object" | 
    "Comparison" | 
    "BoolAlg" | 
    "Int" | 
    "Saved" | 
    "String" |
    "FieldExists" |
    "Selection" |
    "GlobalObject" | 
    "Math" |
    "None" |
    "ArrayLiteral" |
    "Call" |
    "Keys" |
    "RoleInstance" |
    "GetType" |
    "Not" |
    "Is"
    >

export type Key = PickNode<"String" | "Saved">
export type AbstractNodes = PickNode<"GlobalObject">

export type BaseNodeDefs = {
    Return: Node<{value?: ValueNode}, "root">
    Bool: Node<{value: boolean}>
    DeleteField: Node<{}>,
    Field: Node<{key: Key, value: ValueNode}>
    Object: Node<{fields: PickNode<"Field">[]}>
    Int: Node<{value: number}> 
    None: Node<{}>,
    GetType: Node<{value: ValueNode}>
    Not: Node<{value: ValueNode}>
    Comparison: Node<
        {
        sign: "==" | "!=" | "<" | ">" | "<=" | ">="
        left: ValueNode
        right: ValueNode
    }>,
    Math: Node<{
        sign: "+" | "-" | "*" | "/",
        left: ValueNode
        right: ValueNode
    }>,
    Is: Node<{value: ValueNode, type: string}>
    BoolAlg: Node<{
        sign: "and" | "or", 
        left: ValueNode, 
        right: ValueNode}>

    Else: Node<{do: RootNode[]}>
    Finally: Node<{do: RootNode[]}>
    Conditional: Node<{cond: ValueNode, do: RootNode[]}>
    If: Node<{
        conditionally: PickNode<"Conditional" | "Finally" | "Else">[]
    }, "root">
    RoleInstance: Node<{
        role: Extract<Schema, {kind: "Role"}>,
        state?: PickNode<"Object">
    }>
    Noop: Node<{}, "root">
    Saved: Node<{index: number}> 
    String: Node<{value: string}>,
    Selection: Node<{root: ValueNode, level: (ValueNode)[]}>
    FieldExists: Node<{value: ValueNode, field: Key}>
    Save: Node<{value: ValueNode}, "root">
    Update: Node<
    {
        root: PickNode<"Saved" | "GlobalObject">
        level: PickNode<"Selection">["level"]
        operation: PickNode<"DeleteField" | "Push"> | ValueNode,
    }, "root">
    GlobalObject: Node<{name: string}>
    ArrayForEach: Node<{target: ValueNode, do: RootNode[]}, "root">
    Keys: Node<{from: ValueNode}>
    ArrayLiteral: Node<{values: ValueNode[]}>
    Push: Node<{values: ValueNode[]}>
    Call: Node<{function_name: string, args: ValueNode[]}, "root">
    Lock: Node<{name: ValueNode}, "root">
    Release: Node<{name: ValueNode}, "root">
}

export type NodeSet= {[K in string]: Node<{}, "not root" | "root">} 
type NodeInstance<S extends NodeSet, K extends keyof S> = Omit<S[K], "_meta"> & {kind: K}
export type AnyNodeFromSet<S extends NodeSet> = {
    [K in keyof S]: NodeInstance<S, K>
}[keyof S]

export type AnyNode = AnyNodeFromSet<BaseNodeDefs>
export type RootNode = AnyRootNodeFromSet<BaseNodeDefs>
export type AnyRootNodeFromSet<S extends NodeSet> = {
    [K in keyof S]: S[K]["_meta"] extends "not root" ? never : {kind: K} & Omit<S[K], "_meta">
}[keyof S]

export type PickNode<K extends keyof BaseNodeDefs> = Extract<AnyNode, {kind: K}>

export type NodeWithNoXChildren<N extends AnyNode, X extends AnyNode> = {
    [F in keyof N]: N[F] extends ArrayLike<AnyNode> ? Array<Exclude<N[F][0], X>> : Exclude<N[F], X>
}


type ReplaceIfAbstract<Nodes, Replace extends NodeSet> = Extract<Nodes, AbstractNodes> extends never ? Nodes : Exclude<Nodes, AbstractNodes> | AnyNodeFromSet<Replace>
type TargetNode<SomeNode, REPLACE extends NodeSet> = {
    [F in keyof SomeNode]: 
    SomeNode[F] extends ArrayLike<{kind: any}> 
        ? Array<FullyImplementedNode<ReplaceIfAbstract<SomeNode[F][0], REPLACE>, REPLACE>>
        : SomeNode[F] extends AnyNode ? FullyImplementedNode<ReplaceIfAbstract<SomeNode[F], REPLACE>, REPLACE> : SomeNode[F]
}

type FullyImplementedNode<Nodes, REPLACE extends NodeSet> = Exclude<TargetNode<Nodes, REPLACE>, AbstractNodes>

export type PickNodeFromSet<S extends NodeSet, K extends keyof S> = Extract<AnyNodeFromSet<S>, {kind: K}>

export type CompleteCompiler<T extends NodeSet> = {
    [K in keyof T]: (n: NodeInstance<T, K>) => Op[]
}

export type TargetNodeSet<Replacement extends NodeSet> = (FullyImplementedNode<AnyNode, Replacement> | AnyNodeFromSet<Replacement>)
export type AbstractRemovalCompiler<Replacement extends NodeSet> = (roots: RootNode[]) => 
    TargetNodeSet<Replacement>[]

type AnyBaseNonAbstractKey =Exclude<keyof BaseNodeDefs, AbstractNodes["kind"]>
type AbstractNodeReplacerPairs<R extends NodeSet> = {
    // If the types of the node's fields change,
    // Then we know it needs a replacer.
    [K in AnyBaseNonAbstractKey]: Extract<
        {
            [F in keyof PickNode<K>]: PickNode<K>[F] extends Extract<TargetNodeSet<{}>, {kind: K}>[F] ? "same": "changed"
        }[keyof PickNode<K>],
        "changed"> extends never ? never : {
            kind: K
            map: (original: PickNode<K>) => Extract<TargetNodeSet<R>, {kind: K}>
        }
}[AnyBaseNonAbstractKey]


type AbstractNodeReplacementMap<R extends NodeSet> = {
    [K in AbstractNodeReplacerPairs<R>["kind"]]: Extract<AbstractNodeReplacerPairs<R>, {kind: K}>["map"]
}
export type BaseNodesFromTargetSet<TS extends NodeSet> = TargetNode<PickNode<AnyBaseNonAbstractKey>, TS> //TargetNode<Nodes, REPLACE>

export type PickTargetNode<R extends NodeSet, K extends keyof R | AnyBaseNonAbstractKey> = Extract<TargetNodeSet<R>, {kind: K}>

type ReplacerReturnType<R extends NodeSet, K extends AnyNode["kind"]> = K extends AbstractNodes["kind"] ? never : PickTargetNode<R, K>
type GenericReplacer<R extends NodeSet> = <K extends AnyNode["kind"]>(n: PickNode<K>) => ReplacerReturnType<R, K>
type ReplacerFunction<K extends AnyBaseNonAbstractKey, R extends NodeSet> = (n: PickNode<K>, r: GenericReplacer<R>) => (PickTargetNode<R, K> | AnyNodeFromSet<R>)
export type RequiredReplacer<R extends NodeSet> =  {
    [K in AbstractNodeReplacerPairs<R>["kind"]]: ReplacerFunction<K, R>
}
type PassThroughReplacer = {
    [K in Exclude<AnyBaseNonAbstractKey, keyof AbstractNodeReplacementMap<{}>>]: ReplacerFunction<K, {}>
}


const PASS_THROUGH_REPLACER: PassThroughReplacer = {
    Bool: n => n,
    Int: n => n,
    Saved: n => n,
    String: n => n,
    DeleteField: n => n,
    None: _ => _,
    Noop: _ => _,
}

export function make_replacer<R extends NodeSet>(repl: RequiredReplacer<R>): GenericReplacer<R> {
    const requiresGeneric = {...PASS_THROUGH_REPLACER, ...repl}
    const generic: GenericReplacer<R> = (n) => {
        if (n === undefined) {
            return n
        }
        if (n.kind === "GlobalObject") {
            throw Error(`Unexpected global object`)
        }
        //@ts-ignore
        return requiresGeneric[n.kind](n as any, generic) as any 
    }
    return generic
}