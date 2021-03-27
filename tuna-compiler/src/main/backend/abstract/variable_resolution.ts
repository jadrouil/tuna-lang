export interface IVariableResolver {
    get(name: string): number
    push(): void
    pop(): number
    add(name: string): number
}

export class VarResolver implements IVariableResolver {
    private readonly varmap: Record<string, number> = {}
    private readonly scopes: Set<string>[] = [new Set()]
    
    get(name: string): number {
        if (name in this.varmap) {
            return this.varmap[name]
        }
        throw Error(`Cannot find variable of name: ${name}`)
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
