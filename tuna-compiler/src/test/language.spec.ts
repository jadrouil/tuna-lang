import { OPSIFY_MANIFEST, Transformer } from 'conder_core';
import { TUNA_TO_MANIFEST } from '../main/assembled';

describe("language", () => {

    function tunaTest(maybeSucceed: "succeed" | "fail", code: string): jest.ProvidesCallback {
        return (cb) => {
            if (maybeSucceed === "succeed") {
                const ops = TUNA_TO_MANIFEST.then(new Transformer(i => {
                    expect(i).toMatchSnapshot("intermediate representation")
                    return i
                })).then(OPSIFY_MANIFEST).run(code)

            } else {
                expect(() => TUNA_TO_MANIFEST.run(code)).toThrowErrorMatchingSnapshot()
            }
            cb()
        }
    }

    it("should allow a global object", tunaTest("succeed", `const obj = {}`))
        

    it("should allow many global objects",
        tunaTest("succeed", `
        const obj1 = {}
        const obj2 = {}
        `)
    )

    it("should allow empty pub funcs", 
    tunaTest("succeed", `pub func doSomething() {}`))

    it("should allow a fixed number of args in functions",
    tunaTest("succeed", `pub func argy(a, b, c) {

    }`)
    )

    it("should allow return statements within functions",
    tunaTest("succeed", `pub func returny() {
        return
    }`))

    it("should allow setting of keys on a global object", 
    
        tunaTest("succeed",
        `
        const gg = {}
        pub func fff(a) {
            gg.abc = a
            gg[a] = a
            gg['abc'] = a
        }
        `)
    )


    it("should allow getting of nested keys",
    
        tunaTest("succeed",
        `
        const gg = {}
        pub func fff(a) {
            return gg[a].field
        }
        `)
    )

    it('should allow bools, numbers, and strings', tunaTest("succeed", `
    
    pub func fff(a) {
        true
        false
        12
        -12.12
        'hello world'
        {}
    }
    
    `))
    
    it('can declare temp variables', tunaTest("succeed", `
    
    pub func fff(a) {
        const b = true
        let c = false
        const d = a[b]
    }
    
    `))

    it('can overwrite inputs', tunaTest("succeed", `
    
    pub func fff(a) {
        a = false
    }
    `))

    it('cannot have duplicate variables', tunaTest("fail", `
    
    pub func fff(a) {
        const a = true
    }
    `))

    it('cannot have a variable with the same name as a function', tunaTest("fail", `
    
    pub func fff(a) {
        const fff = 12
    }
    `))

    it("does not allow overwriting constants", tunaTest("fail",`
    pub func fff(a) {
        const b = a
        b = 42
    }

    `))
    
    it('only allows global constants', tunaTest("fail", `    
    let someVar = {}
    `))

    it('globals must be empty objects', tunaTest("fail", `
    const someVar = false
    `))

    it("allows users to call keys() on globals and locals", tunaTest("succeed",
    `
    const g = {}
    pub func f(a) {
        const b = a.keys()
        const gk = g.keys()
    }
    `
    ))

    it("allows keys on nested object", tunaTest("succeed", 
    `
    pub func f(a) {
        return a['b'].cdef.keys()
    }
    `
    ))

    //Blocked by https://github.com/Conder-Systems/conder/issues/66
    it.skip("allows indexing into keys results", tunaTest("succeed",
    `
    pub func f(a) {
        return a.keys()[0]
    }
    `))

    it("allows deleting of keys in objects", tunaTest("succeed",
    `
    pub func f(a) {
        delete(a.b)
    }
    `
    ))

    it("shouldn't allow deleting of whole variables", tunaTest("fail",
    `
    pub func f(b0) {
        delete(b0)
    }
    `
    ))

    // #dontlike 
    // delete should work on arrays like it does on objects
    it("allows deleting of array fields even though it produces a runtime error", tunaTest("succeed",
    `
    pub func f(b) {
        delete(b[0])
    }
    `
    ))

    it("allows for loops", tunaTest(
        "succeed",
        `
        pub func loop(arr) {
            for row in arr {
                return row
            }
        }
        `    
    ))

    it("ensure variables declared in for loop are cleaned up", tunaTest(
        "succeed",
        `
        const g = {}
        pub func loop() {
            for row in g.array {
                let some_scoped_var = row
            }
            const should_be_at_index_0 = g.array
            return should_be_at_index_0 
        }
        `
    ))

    it("ifs", tunaTest(
        "succeed",
        `
        pub func maybe(a) {
            if a {
                return a
            }
        }
        `
    ))
})