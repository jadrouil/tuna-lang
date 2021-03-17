class Mutable<V> implements IMutable<V> {
    private readonly v: V
    private readonly k: number
    private readonly map: Map<number, IMutable<V>> 

    constructor(v: V, k: number, map: Map<number, IMutable<V>>) {
        this.v = v
        this.k = k
        this.map = map
    }
    

    mutate(f: (old: V) => V) {
        const newV = f(this.v)
        this.map.set(this.k, new Mutable(newV, this.k, this.map))
    }
}

interface IMutable<Value> {
    mutate(f: (oldValue: Value) => Value): void
}

interface IScopeMap<Value> {
    add(n: number, v?: Value): void
    get(n: number): IMutable<Value> | undefined
    push(): void
    pop(): void
}

export class ScopeMap<Value> implements IScopeMap<Value> {

    private readonly defaultGen: () => Value
    private readonly map: Map<number, IMutable<Value>>

    private readonly scopes: number[]
    private nextVariable: number = 0
    constructor(defaultValue: () => Value) {
        this.defaultGen = defaultValue
        this.map = new Map()
        this.scopes = [0]
    }

    add(n: number, v?: Value) { 
        if (v === undefined) {
            v = this.defaultGen()
        }
        this.scopes.push(this.scopes.pop() + 1)
        if (n !== this.nextVariable++) {
            throw Error(`Unexpected new variable ${n}`)
        }

        this.map.set(n, new Mutable(v, n, this.map))
    }
    get(n: number): IMutable<Value> {
        const r= this.map.get(n)
        if (r === undefined) {
            throw Error(`${n} is not in scope`)
        }
        return r
    }

    push() {
        this.scopes.push(0)
    }

    pop() {
        const removeN = this.scopes.pop()
        for (let index = 0; index < removeN; index++) {
            this.map.delete(--this.nextVariable - index)
        }
    }
}