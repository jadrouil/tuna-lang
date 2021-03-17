export class Stack<T> {
    private readonly data: T[] = []
    private gen: () => T
    constructor(defaultGen: () => T) {
        this.gen = defaultGen
    }

    push() {
        this.data.push(this.gen())
    }

    pop(): T {
        return this.data.pop()
    }

    apply_to_last(f: (i: T) => T) {
        const last = this.pop()
        if (last === undefined) {
            return 
        }
        this.data.push(f(last))
    }
}