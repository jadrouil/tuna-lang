import {Op, ow, Schema } from '../ops/index';
import { base_compiler } from './compilers';
import { AnyNode, AnyRootNodeFromSet, BaseNodeDefs, RootNode } from "./IR";
import { VarResolver } from './variable_resolution';


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


export function functionsToOps(funcs: Map<string, FunctionDescription>): Record<string, Op[]> {
    const ret: Record<string, Op[]> = {}
    funcs.forEach((func, func_name) => {
        const ops: Op[] = [
            ow.assertHeapLen(func.input.length)
        ]
        const varresolver = new VarResolver()

        func.input.forEach(({type, name}, index) => {
            varresolver.add(name)
            ops.push(
                ow.enforceSchemaInstanceOnHeap({heap_pos: index, schema: type}),
                ow.conditonallySkipXops(1),
                ow.raiseError("invalid input")
            )
        })
        func.computation.forEach(node => ops.push(...base_compiler(node, varresolver)))
    
        ret[func_name] = ops
    })
    return ret
}