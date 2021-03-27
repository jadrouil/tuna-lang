import {Op, ow, Schema } from '../ops/index';
import { AnyNode, AnyRootNodeFromSet, BaseNodeDefs, RootNode } from "./IR";
import {MONGO_COMPILER, MONGO_GLOBAL_ABSTRACTION_REMOVAL} from './globals/mongo'
import { Transformer, Compiler } from "./compilers";


export type GlobalObject = {kind: "glob", name: string}

export type Manifest<F=FunctionDescription> = {
    globals: Map<string, GlobalObject>
    funcs: Map<string, F>
}
type Arg = {type: Schema, name: string}
export type FunctionData<COMP=RootNode> = {
    readonly input: Arg[]
    readonly computation: COMP[]
}

export class FunctionDescription<COMP=RootNode> implements FunctionData<COMP>{
    public readonly input: Arg[]
    public readonly computation: COMP[]
    
    constructor(state: FunctionData<COMP>) {
        this.input = state.input
        this.computation = state.computation
    }

    public apply<NEW>(f: (c: COMP) => NEW[]): FunctionDescription<NEW> {
        return new FunctionDescription({
            input: this.input,
            computation: this.computation.flatMap(root => f(root))
        })
    }
}


export function toOps(funcs: Map<string, FunctionDescription>, override:  Compiler<RootNode> | undefined=undefined): Map<string, Op[]> {
    const ret: Map<string, Op[]> = new Map()
    const compiler: Compiler<RootNode> = override ? override : MONGO_GLOBAL_ABSTRACTION_REMOVAL.then(MONGO_COMPILER)
    // const computationLookup: Record<string, RootNode[]> = {}

    // ops.push(...compiler.run(funcs[k].computation))
    funcs.forEach((func, func_name) => {
        const ops: Op[] = [
            ow.assertHeapLen(func.input.length)
        ]
        func.input.forEach((schema, index) => {
            ops.push(
                ow.enforceSchemaInstanceOnHeap({heap_pos: index, schema: schema.type}),
                ow.conditonallySkipXops(1),
                ow.raiseError("invalid input")
            )
        })
    
    
        ret.set(func_name, ops)
    })

    const compiled = compiler.run(funcs)
    funcs.forEach((func, func_name) => {
        ret.set(func_name, [...ret.get(func_name), ...compiled.get(func_name).computation])
    })
    return ret
}


export const OPSIFY_MANIFEST = new Transformer<
    Manifest, 
    Manifest<Op[]>>((man) => {
        const funcs = toOps(man.funcs)
        return {
            funcs,
            globals: man.globals
        }
    })