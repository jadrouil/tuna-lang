import { PickNode, ValueNode } from "conder_core";


export type Sign = PickNode<"Math">["sign"]
type MathNode = PickNode<"Math">["left"]
export type MathExpression = {
    then(sign: Sign, value: MathNode): MathExpression
    build(): ValueNode
}
type MathTup = [Sign, MathNode]
type MathInstr = MathTup | "group barrier"

export class Ordering implements MathExpression {
    //always len(values) == len(signs) + 1
    private readonly first: MathNode
    private readonly instrs: MathInstr[]
    private state?: "+-" | "*" | "/" 
    constructor(first: MathNode) {
        this.first = first
        this.instrs = []
    }

    private startNewGroup(state: Ordering["state"], sign: Sign, value: MathNode, inclusion: "including previous" | "excluding previous") {
        if (inclusion === "including previous") {
            const last = this.instrs.pop()
            this.instrs.push("group barrier")
            this.instrs.push(last, [sign, value])    
        } else {
            this.instrs.push("group barrier")
            this.instrs.push([sign, value])
        }
        this.state = state
    }
    then(sign: Sign, value: MathNode): MathExpression {

        if (this.state) {
            switch (this.state) {
                case "+-":
                    switch (sign) {
                        case "+":
                        case "-":
                            this.instrs.push([sign, value])
                            break
                        case "*":
                        case "/":
                            this.startNewGroup(sign, sign, value, "including previous")
                    }
                    break
                    
                case "*":
                case "/":

                    switch (sign) {
                        case "+":
                        case "-":
                            this.startNewGroup("+-", sign, value, "excluding previous")
                            break
                        case "*":
                        case "/":
                            if (sign !== this.state) {
                                this.instrs.push(["/", value])
                                this.state = sign
                            } else {
                                this.instrs.push(["*", value])
                            }
                            
                    }
            }
        } else {
            this.state = sign === "+" || sign === "-" ? "+-" : sign
            this.instrs.push([sign, value])
        }
        return this
    }

    build(): ValueNode {
        let top = this.first
        console.log(JSON.stringify(this.instrs, null, 2))
        const grouped = this.group()
        console.log(JSON.stringify(grouped, null, 2))
        grouped.forEach(([sign, right]) => {
            top = {
                kind: "Math",
                left: top,
                right,
                sign
            }
        })
        console.log(JSON.stringify(top, null, 2))
        return top
    }

    private group(): MathTup[] {
        
        const tups: MathTup[] = []
        for (let index = 0; index < this.instrs.length; index++) {
            const instr = this.instrs[index];
            if (instr === "group barrier") {
                const lead_tup = this.instrs[++index] as MathTup
                const group_sign = lead_tup[0]
                let right = lead_tup[1]
                
                while(index < this.instrs.length - 1) {
                    const next = this.instrs[++index]
                    if (next === "group barrier") {
                        --index
                        break
                    } else {
                        right = {
                            kind: "Math",
                            sign: next[0],
                            left: right,
                            right: next[1]
                        }
                    }
                }
                tups.push([group_sign, right])
                
            } else {
                tups.push(instr)
            }
        }
        return tups
    }
}