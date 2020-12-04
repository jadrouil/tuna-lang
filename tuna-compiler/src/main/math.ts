import { PickNode, ValueNode } from "conder_core";


export type Sign = PickNode<"Math">["sign"]
type MathNode = PickNode<"Math">["left"]
export type MathExpression = {
    then(sign: Sign, value: MathNode): MathExpression
    build(): ValueNode
}

export class Ordering implements MathExpression {
    //always len(values) == len(signs) + 1
    private value: MathNode
    constructor(first: MathNode) {
        this.value = first
    }

    then(sign: Sign, value: MathNode): MathExpression {
        if (this.value.kind === "Math") {
            if (sign === "*") {
                const right = this.value.right
                this.value.right = {
                    kind: 'Math',
                    left: right,
                    right: value,
                    sign
                }
                return
            }
        }
        
        this.value = {
            kind: 'Math',
            left: this.value,
            right: value,
            sign
        }
        
        return this
    }

    build(): ValueNode {
        return this.value
    }

}