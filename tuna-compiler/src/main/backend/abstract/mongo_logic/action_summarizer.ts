import { DefaultMap } from './../../data_structures/default_map';
import { GraphAnalysis, Subscriptions } from '../../data_structures/visitor';
import { Stack } from '../../data_structures/Stack';
import { Action, ActionSequence, Mutation, ActionKind } from './lock_calculation';
import { MongoNodeSet } from '../globals/mongo';
import { TargetNodeSet, NodeSet, PickTargetNode } from "../IR";
import { Transform, Transformer } from '../compilers';
import { FunctionDescription } from '../function';

type ActionSummarizer = Transform<FunctionDescription<TargetNodeSet<MongoNodeSet>>, ActionSequence>

type NodeSummary = {
    may_perform: ActionSequence,
    uses_data_with_taints: Set<string>,
}

type SummarizerState = {
    active: Stack<NodeSummary>,
    taints: DefaultMap<number, Set<string>>,
    globals_tainting_execution: Set<string>,
    may_perform_any_or_all: ActionSequence,
    next_save_index: number
}

// Provides helper methods across state.
class IntuitiveSummarizerState implements SummarizerState {
    active: Stack<NodeSummary>
    taints: DefaultMap<number, Set<string>>
    globals_tainting_execution: Set<string>
    may_perform_any_or_all: ActionSequence
    private __next_save_index: number
    public get next_save_index(): number {
        return this.__next_save_index++;
    }
    
    public dropVariables(n: number) {
        for (let i = 0; i < n; i++) {
            const cleanup = --this.__next_save_index
            this.taints.delete(cleanup)    
        }
    }

    constructor(inputs: number) {
        this.may_perform_any_or_all = [], 
        this.active = new Stack(() => ({may_perform: [], uses_data_with_taints: new Set(), scope_is_tainted_by: new Set()})), 
        this.taints = new DefaultMap(() => new Set()),
        this.globals_tainting_execution = new Set()
        this.__next_save_index = inputs
    }

    public endSummaryGroupWith(obj: string, action: ActionKind): void {
        const {may_perform: children_did, uses_data_with_taints} = this.endSummaryGroup()
        const this_action: Action<ActionKind> = action === "get" ?
        {kind: "get", id: obj}
        : new Mutation(obj, [...children_did.map(c => c.id), ...uses_data_with_taints.values(), ...this.globals_tainting_execution.values()])

        this.applyToSummaryGroup(parent => {
            parent.may_perform.push(...children_did, this_action)
            uses_data_with_taints.forEach(d => parent.uses_data_with_taints.add(d))
            return parent
        })
        this.may_perform_any_or_all.push(this_action) 
    }

    public startSummaryGroup(): void {
        this.active.push()
    }

    public endSummaryGroup(): NodeSummary {
        return this.active.pop()
    }

    public applyToSummaryGroup(f: Parameters<SummarizerState["active"]["apply_to_last"]>[0]): void {
        this.active.apply_to_last(f)
    }
}

export const MONGO_ACTION_SUMMARIZER: ActionSummarizer = new Transformer(f => {
    const summary_analysis = new GraphAnalysis(SUMMARIZER_SUBSCRIPTIONS, new IntuitiveSummarizerState(f.input.length))
    summary_analysis.apply(f.computation)
    return summary_analysis.state.may_perform_any_or_all
})



const SUMMARIZER_SUBSCRIPTIONS: Subscriptions<IntuitiveSummarizerState, keyof MongoNodeSet> = {
    GetKeyFromObject: {
        before: (n, state) => {
            state.startSummaryGroup()
        },
        after: (n, state) => {
            state.endSummaryGroupWith(n.obj, "get")
        }
    },
    
    GetWholeObject: {
        before: (n, state) => {

        },
        after: (n, state) => {
            state.may_perform_any_or_all.push({kind: "get", id: n.name})
        }
    },

    GetKeysOnly: {
        before: _ => {},
        after: (n, state) => {
            state.may_perform_any_or_all.push({kind: "get", id: n.obj})
        }
    },
    keyExists: {
        before: (n, state) => {
            state.startSummaryGroup()
        },
        after: (n, state) => {
            state.endSummaryGroupWith(n.obj, "get")
        }
    },
    DeleteKeyOnObject: {
        before: (n, state) => {
            state.startSummaryGroup()
        },
        after: (n, state) => {
            state.endSummaryGroupWith(n.obj, "mut")
        }
    },
    SetKeyOnObject: {
        before: (n, state) => {
            state.startSummaryGroup()
        },
        after: (n, state) => {
            state.endSummaryGroupWith(n.obj, "mut")
        }
    },
    PushAtKeyOnObject: {
        before: (n, state) => state.startSummaryGroup(),
        after: (n, state) => state.endSummaryGroupWith(n.obj, "mut")
    },
    Save: {
        before: (n, state, this_visitor) => {
            const save_index =state.next_save_index
            state.startSummaryGroup()
            this_visitor.apply([n.value])
            const {may_perform: children_did, uses_data_with_taints} = state.endSummaryGroup()
            
            const taint = state.taints.get(save_index)

            children_did.forEach(c => taint.add(c.id))
            uses_data_with_taints.forEach(c => taint.add(c))
            state.taints.set(save_index, taint)            
        },
        after: (n, state) => {
            
        }
    },

    Saved: {
        before: (n, state) => {
            
        },
        after: (n, state) => {
            state.applyToSummaryGroup(summary => {
                state.taints.get(n.index).forEach(global => summary.uses_data_with_taints.add(global))
                return summary
            })
        }
    },
    

    Update: {
        before: (n, state, this_visitor) => {
            state.startSummaryGroup() 
            switch (n.root.kind) {
                case "Saved":
                    break

                default:
                    throw Error(`Unexpected update target ${n.kind}`)
            }
            
            
            this_visitor.apply([n.operation])
            const summary = state.endSummaryGroup()
            const is_partial_update = "Push" === n.operation.kind || n.level.length > 0
            const taint = is_partial_update ? state.taints.get(n.root.index) : new Set<string>()
            summary.uses_data_with_taints.forEach(t => taint.add(t))
            summary.may_perform.forEach(c => taint.add(c.id))
            state.taints.set(n.root.index, taint)
        },
        after: (n, state) => {
            
            
        }

    },

    Conditional: {
        before: (n, state, this_visitor) => {
            state.startSummaryGroup()
            this_visitor.apply([n.cond])
            const condition_summary = state.endSummaryGroup()
            condition_summary.may_perform.forEach(c => state.globals_tainting_execution.add(c.id))
            condition_summary.may_perform.forEach(c => state.may_perform_any_or_all.push(c))
            condition_summary.uses_data_with_taints.forEach(c => state.globals_tainting_execution.add(c))

            this_visitor.apply(n.do)
        },
        after: (n, state, this_visitor) => {

        }
    },

    If: {
        before: (n, state, this_visitor) => {
            n.conditionally.forEach(cond => {
                switch (cond.kind) {
                    case "Conditional":
                    case "Else":
                        const num_vars = cond.do.filter(c => c.kind === "Save").length
                        this_visitor.apply(cond.do)
                        state.dropVariables(num_vars)
                        break
                    case "Finally":
                        this_visitor.apply(cond.do)
                        break
                }
            })
        },
        after: _=>{}
    },
    ArrayForEach: {
        before: (n, state, this_visitor) => {
            const row_var_index = state.next_save_index
            state.startSummaryGroup()
            this_visitor.apply([n.target])
            const target_summary = state.endSummaryGroup()
            target_summary.may_perform.forEach(c => state.globals_tainting_execution.add(c.id))
            target_summary.may_perform.forEach(c => state.may_perform_any_or_all.push(c))
            target_summary.uses_data_with_taints.forEach(c => state.globals_tainting_execution.add(c))
            state.taints.set(row_var_index, new Set(
                [
                    ...target_summary.uses_data_with_taints,
                    ...target_summary.may_perform.map(a => a.id)
                ])
            )
            this_visitor.apply(n.do)
            state.dropVariables(
                // + 1 for row variable
                n.do.filter(d => d.kind === "Save").length + 1
            )
        },

        after: _ => {}
    }
}