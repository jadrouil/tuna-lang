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
    Saved: Node<{arg: string}> 
    String: Node<{value: string}>,
    Selection: Node<{root: ValueNode, level: (ValueNode)[]}>
    FieldExists: Node<{value: ValueNode, field: Key}>
    Save: Node<{value: ValueNode, name: string}, "root">
    Update: Node<
    {
        root: PickNode<"Saved" | "GlobalObject">
        level: PickNode<"Selection">["level"]
        operation: PickNode<"DeleteField" | "Push"> | ValueNode,
    }, "root">
    GlobalObject: Node<{name: string}>
    ArrayForEach: Node<{target: ValueNode, do: RootNode[], arg: string}, "root">
    Keys: Node<{from: ValueNode}>
    ArrayLiteral: Node<{values: ValueNode[]}>
    Push: Node<{values: ValueNode[]}>
    Call: Node<{function_name: string, args: ValueNode[]}, "root">
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

