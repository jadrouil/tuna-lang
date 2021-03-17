

export class DefaultMap<K,V> extends Map<K,V> {
    private readonly gen: (k: K) => V
    constructor(builder: (k: K) => V) {
        super()
        this.gen = builder
    }

    get(k: K): V {
        const v = super.get(k)

        if (v === undefined) {
            const newV = this.gen(k)
            super.set(k, newV)
            return newV
        }
        return v
    }
}