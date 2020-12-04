import { PickNode, ValueNode } from "conder_core";


export type Sign = PickNode<"Math">["sign"]
type MathNode = PickNode<"Math">["left"]
export type MathExpression = {
    then(sign: Sign, value: MathNode): MathExpression
    build(): ValueNode
}
type MathTup = [Sign, MathNode]
type MathInstr = MathTup[]

export class Ordering implements MathExpression {
    //always len(values) == len(signs) + 1
    private readonly first: MathNode
    private readonly instrs: MathInstr[]
    private state: "+-" | "*" | "/" | "uninitialized" = "uninitialized"
    constructor(first: MathNode) {
        this.first = first
        this.instrs = []
    }

    private startMultiplication(state: Ordering["state"], sign: Sign, value: MathNode) {
        const last = this.instrs.pop()
        
        const steal = last.pop()
        if (last.length !== 0) {
            this.instrs.push(last)
        }
        this.instrs.push([steal, [sign, value]])
        this.state = state
    }
    pushToGroup(sign: Sign, value: MathNode) {
        const last = this.instrs.pop()
        last.push([sign, value])
        this.instrs.push(last)
    }
    then(sign: Sign, value: MathNode): MathExpression {

        switch (sign) {
            case "+":
            case "-":
                this.state = "+-"
                this.instrs.push([[sign, value]])
                break
            case "*":
            case "/":
                switch (this.state) {
                    case "+-":
                        this.startMultiplication(sign, sign, value)
                        break
                    case "uninitialized":
                        this.state = sign
                        this.instrs.push([[sign, value]])
                        break
                    case "*":
                    case "/":
                        this.pushToGroup(sign === this.state ? "*" : "/", value)
                }
            
        }
        
         
        return this
    }

    build(): ValueNode {
        let top = this.first
        // console.log(JSON.stringify(this.instrs, null, 2))
        const grouped = this.group()
        // console.log(JSON.stringify(grouped, null, 2))
        grouped.forEach(([sign, right]) => {
            top = {
                kind: "Math",
                left: top,
                right,
                sign
            }
        })
        return top
    }

    private group(): MathTup[] {
        
        const tups: MathTup[] = []
        for (let i = 0; i < this.instrs.length; i++) {
            
            const group = this.instrs[i];
            if (group.length === 0) {
                continue
            }
            const lead_tup = group[0]
            const group_sign = lead_tup[0]
            let agg = lead_tup[1]

            for (let j = 1; j < group.length; j++) {
                const [sign, right] = group[j]
                agg = {
                    kind: "Math",
                    sign,
                    left: agg,
                    right
                }
            }
            tups.push([group_sign, agg])
        }
        return tups
    }
}