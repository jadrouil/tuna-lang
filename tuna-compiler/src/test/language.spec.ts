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

                expect(ops).toMatchSnapshot("ops representation")

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

    it("should allow empty public functions", 
    tunaTest("succeed", `public function doSomething() {}`))

    it("should allow a fixed number of args in functions",
    tunaTest("succeed", `public function argy(a, b, c) {

    }`)
    )

    it("should allow return statements within functions",
    tunaTest("succeed", `public function returny() {
        return
    }`))

    it("should allow setting of keys on a global object", 
    
        tunaTest("succeed",
        `
        const gg = {}
        public function fff(a) {
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
        public function fff(a) {
            return gg[a].field
        }
        `)
    )

    it('should allow bools, numbers, and strings', tunaTest("succeed", `
    
    public function fff(a) {
        true
        false
        12
        -12.12
        'hello world'
        {}
    }
    
    `))
    
    it('can declare temp variables', tunaTest("succeed", `
    
    public function fff(a) {
        const b = true
        let c = false
        const d = a[b]
    }
    
    `))

    it('can overwrite inputs', tunaTest("succeed", `
    
    public function fff(a) {
        a = false
    }
    `))

    it('cannot have duplicate variables', tunaTest("fail", `
    
    public function fff(a) {
        const a = true
    }
    `))

    it('cannot have a variable with the same name as a function', tunaTest("fail", `
    
    public function fff(a) {
        const fff = 12
    }
    `))

    it("does not allow overwriting constants", tunaTest("fail",`
    public function fff(a) {
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
})