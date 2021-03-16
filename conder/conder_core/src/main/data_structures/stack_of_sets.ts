
export class StackOfSets<T> {
    private readonly sets: Set<T>[]

    constructor() {
        this.sets = []
    }

    push(): this {
        this.sets.push(new Set())
        return this
    }

    pop(): this {
        this.sets.pop()
        return this
    }
    
    add(t: T): this {
        const last = this.sets.pop()
        this.sets.push(last.add(t))
        return this
    }
}