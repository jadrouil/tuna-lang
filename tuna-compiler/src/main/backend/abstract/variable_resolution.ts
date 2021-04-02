import { PickNode } from "./IR"

export interface IVariableResolver {
    get(name: PickNode<"Saved" | "GlobalObject">): number
    push(): void
    pop(): number
    add(name: string): number
}

export class VarResolver implements IVariableResolver {
    private readonly varmap: Record<string, number> = {}
    private readonly scopes: Set<string>[] = [new Set()]
    
    get(node: PickNode<"Saved" | "GlobalObject">): number {
        switch (node.kind) {
            case "Saved":
                if (node.arg in this.varmap) {
                    return this.varmap[node.arg]
                }
                throw Error(`Cannot find variable of name: ${node.arg}`)
            case "GlobalObject":
                return -1
        }            
    }

    push() {
        this.scopes.push(new Set())
    }

    pop(): number {
        const deleting = this.scopes.pop()
        deleting.forEach(v => {
            delete this.varmap[v]
        })
        return deleting.size
    }

    add(name: string): number {
        const len = Object.keys(this.varmap).length
        this.varmap[name] = len
        this.scopes[this.scopes.length - 1].add(name)
        return len
    }
}
