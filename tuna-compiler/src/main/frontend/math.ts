import { PickNode, ValueNode } from "../backend/index";


export type AnyInfix = MathInfix | CompInfix | BoolInfix

export type MathInfix = PickNode<"Math">["sign"]
type CompInfix = PickNode<"Comparison">["sign"]
type BoolInfix = PickNode<'BoolAlg'>["sign"]
type MathNode = PickNode<"Math">["left"]
export type MathExpression = {
    then(sign: AnyInfix, value: MathNode): MathExpression
    build(): ValueNode
}
type MathTup = [MathInfix, MathNode]
type MathInstr = MathTup[]

export class Ordering implements MathExpression {
    private readonly first: MathNode
    private readonly instrs: MathInstr[]
    private state: "+-" | "*" | "/" | "uninitialized" = "uninitialized"
    constructor(first: MathNode) {
        this.first = first
        this.instrs = []
    }

    private startMultiplication(state: Ordering["state"], sign: MathInfix, value: MathNode) {
        const last = this.instrs.pop()
        
        const steal = last.pop()
        if (last.length !== 0) {
            this.instrs.push(last)
        }
        this.instrs.push([steal, [sign, value]])
        this.state = state
    }
    pushToGroup(sign: MathInfix, value: MathNode) {
        const last = this.instrs.pop()
        last.push([sign, value])
        this.instrs.push(last)
    }
    then(sign: AnyInfix, value: MathNode): MathExpression {

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
                break

            case "and":
            case "or":
                return new BoolAlg(this.build(), sign, new Ordering(value))
            
            case "==":
            case "<=":
            case ">":
            case "<":
            case ">=":
            case "!=":
                const built = this.build()
                return new Comparison(built, sign, new Ordering(value))

            default: const n: never = sign
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

class BoolAlg implements MathExpression {
    private readonly left: ValueNode
    private readonly sign: BoolInfix
    private right: MathExpression
    constructor(left: ValueNode, sign: BoolInfix, right: MathExpression) {
        this.left = left
        this.sign = sign
        this.right = right
    }
    then(sign: AnyInfix, value: MathNode): MathExpression {
        this.right = this.right.then(sign, value)
        return this
    }
    build(): ValueNode {
        return {
            kind: "BoolAlg",
            sign: this.sign,
            left: this.left,
            right: this.right.build()
        }
    }
}

class Comparison implements MathExpression {
    private readonly left: ValueNode
    private readonly sign: CompInfix
    private right: MathExpression
    constructor(left: ValueNode, sign: CompInfix, right: MathExpression) {
        this.left = left
        this.sign = sign
        this.right = right
    }

    then(sign: AnyInfix, value: MathNode): MathExpression {
        switch (sign) {
            case "or":
            case "and":
                return new BoolAlg(this.build(), sign, new Ordering(value))
            default:
                this.right = this.right.then(sign, value)
                return this
        }
    }

    build(): ValueNode {
        return {
            kind: "Comparison",
            left: this.left,
            right: this.right.build(),
            sign: this.sign
        }
    }
}