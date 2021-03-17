// This should eventually be genericized
import { MongoNodeSet } from '../abstract/globals/mongo';
import { TargetNodeSet, NodeSet, PickTargetNode } from "../abstract/IR";

type TargetNodes = TargetNodeSet<MongoNodeSet>
type Visitor = {
    apply: (n: TargetNodes[]) => void
}

type Subscriber<K extends TargetNodes["kind"], STATE> = {
    before: (n: PickTargetNode<MongoNodeSet, K>, state: STATE, thisVisitor: Visitor) => void
    after: (n: PickTargetNode<MongoNodeSet, K>, state: STATE, thisVisitor: Visitor) => void
}

export type Subscriptions<STATE, REQUIRES extends TargetNodes["kind"]=never> = {
    [K in Exclude<TargetNodes["kind"], REQUIRES>]?: Subscriber<K, STATE>
} & {
    [K in Extract<TargetNodes["kind"], REQUIRES>]: Subscriber<K, STATE>
}

// Sees everything but does nothing.
export class GraphAnalysis<STATE> implements Visitor {

    private readonly subs: Subscriptions<STATE>
    readonly state: STATE
    constructor(subs: Subscriptions<STATE>, initial_state: STATE) {
        this.subs = subs
        this.state = initial_state
    }   

    apply(nodes: TargetNodes[]): void {
        nodes.forEach(n => {
            const subscriber: Subscriber<any, STATE> = this.subs[n.kind]
            if (subscriber) {
                subscriber.before(n, this.state, this)
            }
            
            const children = extract_children(n)
            this.apply(children)
    
            if (subscriber) {
                subscriber.after(n, this.state, this)
            }
        })   
    }
}


function extract_children(n: TargetNodes): TargetNodes[] {
    // It would make me oh so happy if there was a generic type that could said:
    // For all nodes, for those fields of the nodes that point to nodes (i.e. are edges),
    // specify the traversal priority across the edges.
    // Then a generic visitor object could be initialized with that.
    switch (n.kind) {
        case "Save":  
        case "GetType":
        case "Not":
        case "Is":
            return [n.value]
        case "Return":
            return n.value ? [n.value] : []
        case "Object":
            return n.fields

        case "Math":
        case "Comparison":
        case "BoolAlg":
            return [n.left, n.right]
            
        case "If":
            return n.conditionally
        case "Conditional":
            return [n.cond, ...n.do]

        case "GetKeyFromObject":
        case "DeleteKeyOnObject":
            return n.key

        case "Selection":
            return [n.root, ...n.level]

        case "FieldExists":
            return [n.value, n.field]
        
        case "keyExists":
            return [n.key]
        case "Update":
            return [n.root, n.operation]
        case "SetKeyOnObject":
            return [...n.key, n.value]
        case "Field":                
            return [n.key, n.value]

        case "Keys":        
        case "Int":                
        case "GetWholeObject":
        case "Bool":
        case "String":
        case "Saved":
        case "None":
        case "Noop":
        case "DeleteField":
        case "GetKeysOnly":
        case "RoleInstance":
            return []
        case "ArrayForEach":
            return [n.target, ...n.do]

        case "ArrayLiteral":
        case "Push":
        
            return n.values
        case "Else":
        case "Finally":
            return n.do
    
        case "PushAtKeyOnObject":
            return [...n.key, ...n.values]
        case "Call":
            return [...n.args]
        
        case "Lock":
        case "Release":
            return [n.name]
        default: 
            const ne: never = n
            
    }
}