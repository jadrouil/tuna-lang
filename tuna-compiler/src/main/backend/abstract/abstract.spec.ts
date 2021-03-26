import { Schema } from './../ops/bindings';
import { Compiler } from './compilers';
import { MONGO_COMPILER, MONGO_GLOBAL_ABSTRACTION_REMOVAL } from './globals/mongo';

import {Op, StrongServerEnv, Test} from '../ops/index'
import { AnyNode, RootNode, BaseNodeDefs, PickNode, toOps } from '../index'
import { MONGO_UNPROVIDED_LOCK_CALCULATOR } from './mongo_logic/main';
import { FunctionData, FunctionDescription } from './function';
import * as ed from 'noble-ed25519';

type DagServer = Record<string, (...arg: any[]) => Promise<any>>
const TEST_STORE = "test"
const GLOBAL: PickNode<"GlobalObject"> = {kind: "GlobalObject", name: TEST_STORE}
const testCompiler: Compiler<RootNode> =  MONGO_GLOBAL_ABSTRACTION_REMOVAL
    .tap((nonAbstractRepresentation) => {
        const locks = MONGO_UNPROVIDED_LOCK_CALCULATOR.run(nonAbstractRepresentation)
        expect(locks).toMatchSnapshot(`Required locks`)
    })
    .then(MONGO_COMPILER)

class TestHarness {
    private serverEnv: StrongServerEnv
    private readonly resources: (() => Promise<Killable>)[] = []
    constructor() {
    }
    withReq(req: TestReq): this {
        switch (req) {
            case "storage":
                this.resources.push(() => Test.Mongo.start(this.serverEnv).then(mongo => {                    
                    this.serverEnv.MONGO_CONNECTION_URI = `mongodb://localhost:${mongo.port}`
                    return mongo
                })) 
                return this
            case "locks":
                this.resources.push(() => Test.EtcD.start().then(etcd => {
                    this.serverEnv.ETCD_URL = `http://localhost:${etcd.port}`
                    return etcd
                }))
                return this
            default: const n: never = req
        }
    }

    test(test: ServerTest, proc_nodes: Record<string, FunctionData>): jest.ProvidesCallback {
        return async (cb) => {
            const map = new Map(
                Object.entries(proc_nodes)
                .map(([k, v]) => [k, new FunctionDescription(v)]))
            const compiled = toOps(map, testCompiler)
            const PROCEDURES: Record<string, Op[]> = Object.fromEntries(compiled.entries())
            const STORES: StrongServerEnv["STORES"] = {TEST_STORE: {kind: "Object", data: {}}}
            const secret = ed.utils.randomPrivateKey()
            const pub = await ed.getPublicKey(secret)
            this.serverEnv = {
                PROCEDURES, 
                STORES, 
                SCHEMAS: {}, 
                DEPLOYMENT_NAME: "test",
                PUBLIC_KEY: pub,
                PRIVATE_KEY: new Uint8Array([...secret, ...pub])
            }

            const must_cleanup = await Promise.all(this.resources.map(f => f()))
            const server = await Test.Server.start(this.serverEnv)
            must_cleanup.push(server)
            const testSurface: DagServer = {}
            for (const key in this.serverEnv.PROCEDURES) {
                testSurface[key] = (...args) => server.invoke(key, ...args)
            }

            return test(testSurface).then(() => {
                must_cleanup.forEach(r => r.kill())
                cb()
            }).catch((e) => {
                must_cleanup.forEach(r => r.kill())
                throw e
            })
        }
    }
}

type Killable = {kill: () => void}
type TestReq = "storage" | "locks"
type ServerTest = (server: DagServer) => Promise<void>
function withInputHarness(
    reqs: TestReq[],
    proc_nodes: Record<string, FunctionData>,
    test: (server: DagServer) => Promise<void>): jest.ProvidesCallback {
    
    const builder = new TestHarness()
    reqs.forEach(r => builder.withReq(r))
    return builder.test(test, proc_nodes)
}

    

function noInputHarness(
    proc_nodes: Record<string, RootNode[]>, 
    test: (server: DagServer) => Promise<void>,
    maybeStorage: Parameters<typeof withInputHarness>[0]=[]
    ): jest.ProvidesCallback {
    const PROCEDURES: Record<string, FunctionDescription> = {}
    for (const key in proc_nodes) {
        PROCEDURES[key] = new FunctionDescription({input: [], computation: proc_nodes[key]})
    }
    
    return withInputHarness(maybeStorage,PROCEDURES, test)
}



describe("basic functionality", () => {
    

    it("return node returns null", 
        noInputHarness({
            r: [{kind: "Return"}]
        },
        async (server) => {
            const res = await server.r()
            expect(res).toBeNull()
        })
    )

    it("return node with value returns value",
        noInputHarness({
            r: [{
                kind: "Return", 
                value: {
                    kind: "Object", 
                    fields: [{
                        kind: "Field", 
                        key: {kind: "String", value: "some_field"}, 
                        value: {
                            kind: "Bool", 
                            value: false
                        }
                    }
                ]}
            }]
        }, async (server) => {
            expect(await server.r()).toEqual({some_field: false})
        })
    )

    it("can set double nested field",
        noInputHarness({
            r: [{
                    kind: "Save", 
                    value: {
                        kind: "Object", 
                        fields: [{
                            kind: "Field",
                            key: {kind: "String", value: "nested"}, 
                            value: {
                                kind: "Object", 
                                fields: []
                            }
                        }]
                    }
                },
                {
                    kind: "Update",
                    root: {kind: "Saved", index: 0},
                    level: [{kind: "String", value: "nested"}, {kind: "String", value: "inside"}],
                    operation: { kind: "String", value: "hello world"}
                },
                {kind: "Return", value: {kind: "Saved", index: 0}}
            ]
        }, async (server) => {
            expect(await server.r()).toEqual({nested: {inside: "hello world"}})
        })
    )

    it("can get type info",
        withInputHarness([], {
            whatType: {
                input: [{kind: "Any", data: null}],
                computation: [{
                    kind: "Return",
                    value: {kind: "GetType", value: {kind: 'Saved', index: 0}}
                }]
            }
        },
        async server => {
            expect(await server.whatType([])).toEqual("arr")
            expect(await server.whatType("a")).toEqual("str")
            expect(await server.whatType(1)).toEqual("int")
            expect(await server.whatType({})).toEqual("obj")
            expect(await server.whatType(1.1)).toEqual("doub")
            expect(await server.whatType(null)).toEqual("none")
            expect(await server.whatType(true)).toEqual("bool")
        })
    )

    it("allows deleting of fields on local objects",
        withInputHarness(
            [], 
            {
                delete: {
                    input: [{kind: "Any", data: null}], 
                    computation: [
                        {
                            kind: "Update", 
                            root:{kind: "Saved", index: 0},
                            level: [{kind: "String", value: "some_key"}],
                            operation: {kind: "DeleteField"}
                        },
                        {
                            kind: "Return",
                            value: {kind: "Saved", index: 0}
                        }
                    ]}},
            async server => {
                expect(await server.delete({some_key: false, other: true})).toEqual({other: true})
                expect(await server.delete({})).toEqual({})
            }
        )
    )

    it("allows gathering of keys on objects",
            withInputHarness(
                [],
                {
                    getKeys: {
                        input: [{kind: "Object", data: {a: {kind: "Any", data: null}}}],
                        computation: [
                            {kind: "Return", value: {
                                kind: 'Keys',
                                from: {kind: "Saved", index: 0}
                            }}
                        ]
                    }
                },
                async server => {
                    expect(await server.getKeys({a: "yada yada"})).toEqual(["a"])
                }
            )
    )

    it("allows directly indexing into object keys",
            withInputHarness(
                [],
                {
                    getKeys: {
                        input: [{kind: "Object", data: {a: {kind: "Any", data: null}}}],
                        computation: [
                            {
                                kind: "Return", 
                                value: {
                                    kind: "Selection",
                                    root: {kind: "Keys", from: {kind: "Saved", index: 0}},
                                    level: [{kind: "Int", value: 0}]
                                }
                            }
                        ]
                    }
                },
                async server => {
                    expect(await server.getKeys({a: "yada yada"})).toEqual("a")
                }
            )
    )

    it("allows deleting of nested fields on locals",
        withInputHarness(
            [], 
            {
                delete: {
                    input: [{kind: "Any", data: null}], 
                    computation: [
                        {
                            kind: "Update", 
                            root: {kind: "Saved", index: 0},
                            level: [{kind: "String", value: "l1"}, {kind: "String", value: "l2"}],
                            operation: {kind: "DeleteField"}
                        },
                        {
                            kind: "Return",
                            value: {kind: "Saved", index: 0}
                        }
                    ]}},
            async server => {
                expect(await server.delete({l1: {l2: false, other: true}})).toEqual({l1: {other: true}})
                expect(await server.delete({l1: {}})).toEqual({l1: {}})
            }
        )
    )

    it("can get nested field",
        noInputHarness({
            r: [{
                    kind: "Save", 
                    value: {
                        kind: "Object", 
                        fields: [{
                            kind: "Field", 
                            key: {kind: "String", value: "l1"}, 
                            value: {
                                kind: "Object", 
                                fields: []
                            }
                        }]
                    }
                },
                {
                    kind: "Update",
                    root: {kind: "Saved", index: 0},
                    level: [{kind: "String", value: "l1"}, {kind: "String", value: "l2"}],
                    operation: { kind: "String", value: "hello world"}
                },
                {kind: "Return", value: {
                    kind: "Selection", 
                    level: [{kind: "String", value: "l1"}, {kind: "String", value: "l2"}],
                    root: {kind: "Saved", index: 0}
                }}
            ]
        }, async (server) => {
            expect(await server.r()).toEqual("hello world")
        })
    )

    function nComp(sign: PickNode<"Comparison">["sign"], right: number): FunctionData {
        return {
            input: [{kind: "int", data: null}],
            computation: [{
            kind: "Return",
            value: {
                kind: "Comparison",
                sign,
                left: {kind: "Saved", index: 0},
                right: {kind: "Int", value: right}
            }
        }]}
    }
    it("can compare numbers", 
        withInputHarness([],{
            geq: nComp(">=", 10),
            leq: nComp("<=", 10),
            l: nComp("<", 10),
            g: nComp(">", 10),
            e: nComp("==", 10),
            ne: nComp("!=", 10),
        }, async server => {
            
            const args = {
                less: 5, 
                equal: 10,
                greater: 11
            }
            const expectations = {
                geq: {less: false, equal: true, greater: true},
                leq: {less: true, equal: true, greater: false},
                g: {less: false, equal: false, greater: true},
                e: {less: false, equal: true, greater: false},
                l: {less: true, equal: false, greater: false},
                ne: {less: true, equal: false, greater: true},
            }
            for (const func in expectations) {
                //@ts-ignore
                const func_exp = expectations[func]                
                for (const comp in func_exp) {
                    //@ts-ignore
                    const arg = args[comp]                    
                    const res = await server[func](arg)
                    const exp = func_exp[comp]
                    if (res !== exp) {
                        expect(`${func}(${arg}) should have been ${exp}`).toBe('')
                    }
                }
            }
        })
    )

    function boolAlgTest(sign: PickNode<"BoolAlg">["sign"], left: PickNode<"BoolAlg">["left"], right: PickNode<"BoolAlg">["right"]): RootNode[] {
        return [{
            kind: "Return",
            value: {
                kind: "BoolAlg",
                left,
                right,
                sign
            }
        }]
    }
    it("can handle boolean algebra", 
        noInputHarness({
            trueNtrue: boolAlgTest("and", {kind: "Bool", value: true}, {kind: "Bool", value: true}),
            falseNtrue: boolAlgTest("and", {kind: "Bool", value: false}, {kind: "Bool", value: true}),
            trueNfalse: boolAlgTest("and", {kind: "Bool", value: true}, {kind: "Bool", value: false}),
            trueOtrue: boolAlgTest("or", {kind: "Bool", value: true}, {kind: "Bool", value: true}),
            falseOtrue: boolAlgTest("or", {kind: "Bool", value: false}, {kind: "Bool", value: true}),
            trueOfalse: boolAlgTest("or", {kind: "Bool", value: true}, {kind: "Bool", value: false}),
            falseOfalse: boolAlgTest("or", {kind: "Bool", value: false}, {kind: "Bool", value: false})

        }, async server => {
            expect(await server.trueNtrue()).toBeTruthy()
            expect(await server.falseNtrue()).toBeFalsy()
            expect(await server.trueNfalse()).toBeFalsy()
            expect(await server.trueOtrue()).toBeTruthy()
            expect(await server.trueOfalse()).toBeTruthy()
            expect(await server.falseOtrue()).toBeTruthy()
            expect(await server.falseOfalse()).toBeFalsy()
        })
    )

    it("supports basic math",
        noInputHarness({
            minus: [{kind: "Return", value: {
                kind: "Math",
                left: {kind: "Int", value: 42},
                right: {kind: "Int", value: -42},
                sign: "-"
            }}]
        }, async server => {
            expect(await server.minus()).toBe(84)
        })
    
    )

    it("allows if statements", 
        noInputHarness({
            ifTrue: [{
                kind: "If",
                conditionally: [
                    {
                        kind: "Conditional", 
                        cond: {kind: "Bool", value: true},
                        do: [{kind: "Return", value: {kind: "Int", value: 1}}]
                    }
                ]
            }],
            ifFalseNoFinally: [{
                kind: "If",
                conditionally: [
                    {
                        kind: "Conditional", 
                        cond: {kind: "Bool", value: false}, 
                        do: [{kind: "Return", value: {kind: "Int", value: 1}}]
                    },
                ]
            }],
            ifFalseFinally: [{
                kind: "If",
                conditionally: [
                    {kind: "Conditional", cond: {kind: "Bool", value: false}, do: [{kind: "Return"}]},
                    {kind: "Finally", do: [{kind: "Return", value: {kind: "Int", value: 2}}]}
                ]
            }]
        }, 
            async server => {
                expect(await server.ifTrue()).toBe(1)
                expect(await server.ifFalseNoFinally()).toBeNull()
                expect(await server.ifFalseFinally()).toBe(2)
        })
    )

    it("allows elses", 
        noInputHarness({
            else: [{
                kind: "If",
                conditionally: [
                    {kind: "Conditional", cond: {kind: "Bool", value: false}, do: [{kind: "Return"}]},
                    {kind: "Else", do: [{kind: "Return", value: {kind: "Int", value: 42}}]}
                ]
            }] 
        },
        async server => {
            expect(await server.else()).toBe(42)
        })
    )

    it("allows else ifs", 
        noInputHarness({
            elseIfs: [{
                kind: "If",
                conditionally: [
                    {kind: "Conditional", cond: {kind: "Bool", value: false}, do: [{kind: "Return"}]},
                    {kind: "Conditional", cond:  {kind: "Bool", value: false}, do: [{kind: "Return"}]},
                    {kind: "Conditional", cond: {kind: "Bool", value: true}, do: [{kind: "Return", value: {kind: "Int", value: 42}}]}
                ]
            }] 
        },
        async server => {
            expect(await server.elseIfs()).toBe(42)
        })
    )

    it("cleans up after ifs", noInputHarness({
        ifVars: [
            {
                kind: "If",
                conditionally: [
                    {kind: "Conditional", 
                    cond: {kind: "Bool", value: true}, 
                    do: [{kind: "Save", value: {kind: "Int", value: -1}}]},
                ]
            },
            {
                kind: "Save",
                value: {kind: "Int", value: 2}
            },
            {
                kind: "Return", value: {kind: "Saved", index: 0}
            }
    ] 
    },
    async server => {
        expect(await server.ifVars()).toBe(2)
    })
    )

    it("cleans up after for eachs", noInputHarness({
        forVars: [
            {
                kind: "ArrayForEach",
                target: {kind: "ArrayLiteral", values: [{kind: "Bool", value: true}]},
                do: [{kind: "Save", value: {kind: "Int", value: -1}}],
            },
            {
                kind: "Save",
                value: {kind: "Int", value: 2}
            },
            {
                kind: "Return", value: {kind: "Saved", index: 0}
            }
    ] 
    },
    async server => {
        expect(await server.forVars()).toBe(2)
    })
    )

    it("allows pushing to local arrays", withInputHarness(
        [],
        {
            push: {
                input: [{kind: "Array", data: [{kind: "Any", data: null}]}],
                computation: [
                    {
                        kind: "Update",
                        root: {kind: "Saved", index: 0},
                        level: [],
                        operation: {
                            kind: "Push", 
                            values: [
                                {kind: "String", value: "hello"},
                                {kind: "Int", value: 12}
                            ]
                        }
                    },
                    {kind: "Return", value: {kind: "Saved", index: 0}}
                ],
            }
        },
        async server => {
            expect(await server.push(["a"])).toEqual(["a", "hello", 12])
        }
    ))
    
    it("allows pushing to nested local arrays", withInputHarness(
        [],
        {
            push: {
                input: [{kind: "Any", data: null}],
                computation: [
                    {
                        kind: "Update",
                        root: {kind: "Saved", index: 0},
                        level: [{kind: "String", value: "array"}],
                        operation: {
                            kind: "Push", 
                            values: [
                                {kind: "String", value: "hello"},
                                {kind: "Int", value: 12}
                            ]
                        }
                    },
                    {
                        kind: "Return", 
                        value: {
                            kind: 'Selection',
                            root: {kind: "Saved", index: 0},
                            level: [{kind: "String", value: "array"}]
                        }
                    }
                ],
            }
        },
        async server => {
            expect(await server.push({array: ["a"]})).toEqual(["a", "hello", 12])
        }
    ))

    it("allows indexing into arrays with an int", withInputHarness(
        ["storage"],
        {
            getFirst: {
                input: [{kind: "Array", data: [{kind: "Any", data: null}]}],
                computation: [
                    {
                        kind: "Return",
                        value: {
                            kind: "Selection",
                            root: {kind: "Saved", index:0},
                            level: [{kind: "Int", value: 0}]
                        }
                    }
                ]
            }
        },
        async server => {
            expect(await server.getFirst(["a", "b"])).toBe("a")
        }
    ))
})

describe("roles", () => {
    it("functions can be guarded by roles", withInputHarness([], {
        adminsOnly: {
            input: [{kind: "Role", data: ["admin", [{kind: "Object", data: {}}]]}],
            computation: [
                {kind: "Return", value: {kind: "String", value: "success"}}
            ]
        },
        getAdminId: {
            input: [],
            computation: [
                {kind: 'Return', value: {kind: "RoleInstance", role: {kind: "Role", data: ["admin", [{kind: "Object", data: {}}]]}}}
            ]
        }
    }, async server => {
        await expect(server.adminsOnly({})).rejects.toThrowError()
        const id = await server.getAdminId()
        expect(await server.adminsOnly(id)).toEqual("success")
    }))
    
    const user_role: Extract<Schema, {kind: "Role"}> = {kind: "Role", data: ["user", [{kind: "Object", data: {name: {kind: "string", data: null}}}]]}
    it("allows use of stateful roles", 
        withInputHarness([], {
            usersOnly: {
                input: [user_role],
                computation: [
                    {kind: 'Return', value: {
                        kind: "Selection", 
                        root: {kind: "Saved", index: 0}, 
                        level: [{kind: "String", value: "_state"}, {kind: "String", value: "name"}]}
                    }
                ]
            },
            getUser: {
                input: [{kind: "string", data: null}],
                computation: [
                    {
                        kind: "Return",
                        value: {
                            kind: "RoleInstance",
                            role: user_role,
                            state: {
                                kind: "Object",
                                fields: [
                                    {
                                        kind: "Field",
                                        key: {kind: "String", value: "name"},
                                        value: {kind: "Saved", index: 0}
                                    }
                                ]
                            }
                        }
                    }
                ]
            }
        },
        async server => {
            const user = await server.getUser("me")
            await expect(server.usersOnly({_name: "user", _state: {name: "me"}})).rejects.toThrowError()
            expect(await server.usersOnly(user)).toEqual("me")
        }))
})

describe("with input", () => {
    it("validates input", withInputHarness([],{
        accepts3any: {
            input: [
                {kind: "Any", data: null},
                {kind: "Any", data: null},
                {kind: "Any", data: null}
            ],
            computation: [{
                kind: "Return",
                value: {
                    kind: "Saved",
                    index: 2
                }
            }]
        }
    }, async server => {
        await expect(server.accepts3any("a", "b", "c", "d")).rejects.toThrowError()
        await expect(server.accepts3any("a", "b",)).rejects.toThrowError()
        expect(await server.accepts3any("a", "b", "c")).toEqual("c")
    }))

    it("check if field exists", withInputHarness([],{
        checksField: {
            input: [
                {kind: "Any", data: null}
            ],
            computation: [{
                kind: "Return",
                value: {
                    kind: "FieldExists",
                    field: {kind: "String", value: "test"},
                    value: {kind: "Saved", index: 0}
                }
            }]
        }
    }, async server => {
        expect(await server.checksField({test: "some"})).toBeTruthy()
        expect(await server.checksField({test: null})).toBeFalsy()
        expect(await server.checksField({t: "a"})).toBeFalsy()
    }))
    
})

describe("global objects", () => {

    const get: RootNode[] = [
        {
            kind: "Return", 
            value: {
                kind: "Selection", 
                root: GLOBAL,
                level: [{
                    kind: "String",
                    value: "l1"
                }]
            }
        }
    ]
    it("getting a non existent key returns null", 
        noInputHarness({
            get,
        }, 
        async server => {
            expect(await server.get()).toBeNull()
        }, 
        ["storage"])
    )

    const set: RootNode[] = [{
        kind: "Update",
        root: GLOBAL,
        level: [{kind: "String", value: "l1"}],
        operation: {kind: "Object", fields: [
            {
                kind: "Field",
                value: {
                    kind: "Int", value: 42
                },
                key: {kind: "String", value: "l2"}
            }
        ]}
    }]

    it("allows calling functions",
        noInputHarness({
            caller: [
                {kind: "Return", value: {
                    kind: "Call", function_name: "callee", args: []
                }}
            ],
            callee: [
                {kind: "Return", value: {kind: "String", value: "Hello"}}
            ]
        },
        async server => {
            expect(await server.caller()).toEqual("Hello")
        }
        )
    )

    it("getting a key returns the value",
        noInputHarness({
            get,
            set,
            getWhole: [
                {kind: "Return", value: {kind: "Selection", level: [], root: GLOBAL}}
            ]
        },
        async server => {
            expect(await server.set()).toBeNull()
            expect(await server.get()).toEqual({l2: 42})
            expect(await server.getWhole()).toEqual({l1: {l2: 42}})
        },
        ["storage"]
        )
    )

    it("allows conditional updates", noInputHarness({
        maybeSet: [
            {kind: "If", conditionally: [{
                kind: "Conditional",
                cond: {
                    kind: "Comparison", 
                    left: {kind: "Selection", root: GLOBAL, level: [{kind: "String", value: "k"}]},
                    right: {kind: "None"},
                    sign: "!="
                },
                do: [
                    {kind: "Save", value: {kind: "Selection", root: GLOBAL, level: [{kind: "String", value: "k"}]}},
                    {kind: "Save", value: {kind: "Object", fields: []}},
                    {kind: "ArrayForEach", target: {kind: "Saved", index: 0}, do: [
                        {
                            kind: "Update",
                            root: {kind: "Saved", index: 1}, level: [{kind: "Saved", index: 2}],
                            operation: {kind: "Selection", root: GLOBAL, level: [{kind: "Saved", index: 2}]}
                        }
                    ]}
                ]
                
            }]},
        ]
        },
        async server => {
            expect(await server.maybeSet()).toBeNull()
        },
        ["storage"]
    ))


    it("allows getting a key with a number key", noInputHarness({
        get: [
            {
                kind: "Return", 
                value: {
                    kind: "Selection", 
                    root: GLOBAL,
                    level: [{
                        kind: "Int",
                        value: 1
                    }]
                }
            }
        ],
        set: [
            {
                kind: "Update",
                root: GLOBAL,
                level: [{kind: "Int", value: 1}],
                operation: {kind: "String", value: "Number field"}
            }
        ]
    },
    async server => {
        expect(await server.set()).toBeNull()
        expect(await server.get()).toEqual("Number field")
    },
    ["storage"]
    ))

    it("can get keys from global objects", 
        noInputHarness({
            getKeys: [{
                kind: "Return",
                value: {kind: "Keys", from: GLOBAL}
            }],
            setKeys: [{
                kind: "Update",
                root: GLOBAL,
                level: [{kind: "String", value: "k1"}],
                operation: {kind: "String", value: "v1"}
            }]
        },
        async server => {
            expect(await server.getKeys()).toEqual([])
            expect(await server.setKeys()).toBeNull()
            expect(await server.getKeys()).toEqual(["k1"])
        },
        ["storage"])
    )

    const getNested: RootNode[] = [
        {
            kind: "Return", 
            value: {
                kind: "Selection", 
                root: GLOBAL,
                level: [{kind: "String", value: "l1"}, {kind: "String", value: "l2"}]
            }
        }
    ]
  
    it("getting a non existent nested field throws an error",
        noInputHarness({getNested},
        async server => {
            await expect(server.getNested()).rejects.toThrowError()
        },
        ["storage"]
        )
    )

    const setNested: RootNode[] = [{
        kind: "Update",
        root: GLOBAL,
        level: [{kind: "String", value: "l1"}, {kind: "String", value: "l2"}],
        operation: {
            kind: "Int", value: 41
        }      
    }]
    it("setting a nested key on a non existent object throws an error",
        noInputHarness(
            {
                setNested,
                get,
                getNested
            },
            async server => {
                await expect(server.setNested()).rejects.toThrowError()
                await expect(server.getNested()).rejects.toThrowError()
                expect(await server.get()).toBeNull()
            },
            ["storage"]
        )
    )

    it("setting a nested key on an existing object",
        noInputHarness(
            {
                setNested,
                set,
                get,
                getNested
            },
            async server => {
                expect(await server.set()).toBeNull()
                expect(await server.setNested()).toBeNull()
                expect(await server.getNested()).toEqual(41)
                expect(await server.get()).toEqual({l2: 41})
                expect(await server.set()).toBeNull()
                expect(await server.getNested()).toEqual(42)
            },
            ["storage"]
        )
    )

    const checkL1: RootNode[] = [{
        kind: "Return",
        value: {
            kind: "FieldExists",
            value: GLOBAL,
            field: {kind: "String", value: "l1"}
        }
    }]
    it("can check existence of keys",
        noInputHarness(
            {
                set,
                checkL1
            },
            async server => {
                expect(await server.checkL1()).toBe(false)
                expect(await server.set()).toBeNull()
                expect(await server.checkL1()).toBe(true)
            },
            ["storage"]
        )
    )


    it("allows deleting of keys on global objects",
        noInputHarness(
            
            {
                delete: [
                        {
                            kind: "Update", 
                            root: GLOBAL,
                            level: [{kind: "String", value: "l1"}],
                            operation: {kind: "DeleteField"}
                        }
                    ],
                set,
                get
            },
            async server => {
                expect(await server.delete()).toBeNull()
                expect(await server.set()).toBeNull()
                expect(await server.get()).toEqual({l2: 42})
                expect(await server.delete()).toBeNull()
                expect(await server.get()).toBeNull()
            },
            ["storage"]
        )
    )

    it("allows deleting of nested fields on globals",
        noInputHarness( 
            {
                delete: [
                        {
                            kind: "Update", 
                            root: GLOBAL,
                            level: [{kind: "String", value: "l1"}, {kind: "String", value: "l2"}],
                            operation: {kind: "DeleteField"}
                        }
                    ],
                set,
                get,
            },
            async server => {
                // Deleting a nested field on an object that does not exist is acceptable.
                expect(await server.delete()).toBeNull()
                expect(await server.set()).toBeNull()
                expect(await server.get()).toEqual({l2: 42})
                expect(await server.delete()).toBeNull()
                expect(await server.get()).toEqual({})
            },
            ["storage"]
        )
    )

    const arrLevel: PickNode<"String"> = {kind: "String", value: "arr"}
    it("can push to arrays in global objects", 
        noInputHarness(
            {
                init: [
                    {
                        kind: "Update",
                        root: GLOBAL,
                        level: [arrLevel],
                        operation: {kind: "ArrayLiteral", values: []}
                    },
                    {
                        kind: "Update",
                        root: GLOBAL,
                        level: [{kind: "String", value: "nested"}],
                        operation: {kind: "Object", fields: [{kind: 'Field', key: arrLevel, value: {kind: "ArrayLiteral", values: []}}]}
                    }
                ],
                push: [
                    {
                        kind: "Update",
                        root: GLOBAL,
                        level: [{kind: "String", value: "arr"}],
                        operation: {kind: "Push", values: [{kind: 'String', value: "HELLO"}]}
                    },
                    {
                        kind: "Update",
                        root: GLOBAL,
                        level: [{kind: "String", value: "nested"}, arrLevel],
                        operation: {kind: "Push", values: [{kind: 'String', value: "HELLO"}]}
                    }
                ],
                get: [
                    {
                        kind: "Save", value: {kind: "Object", fields: []}
                    },
                    {
                        kind: "ArrayForEach",
                        target:{kind: "Keys", from: GLOBAL},
                        do: [
                            {
                                kind: "Update", 
                                root: {kind: "Saved", index: 0},
                                level: [{kind: "Saved", index: 1}],
                                operation: {kind: "Selection", root: GLOBAL, level: [{kind: "Saved", index: 1}
                                ]}
                            }
                        ]
                    },
                    {
                        kind: "Return",
                        value: {kind: 'Saved', index: 0}
                    }
                ]
            }, 
            async server => {
                expect(await server.init()).toBeNull()
                expect(await server.push()).toBeNull()
                expect(await server.get()).toEqual({arr: ["HELLO"], nested: {arr: ["HELLO"]}})
            },
            ["storage"]
        )
    )

    it("can perform updates to objects within arrays",
        noInputHarness(
            {
                init: [
                    {
                        kind: "Update",
                        root: GLOBAL,
                        level: [{kind: 'String', value: "l1"}],
                        operation: {
                            kind: "Object",
                            fields: [{
                                kind: "Field",
                                key: {kind: "String", value: "l2"},
                                value: {
                                    kind: "ArrayLiteral",
                                    values: [
                                        {kind: "Bool", value: false}
                                    ]
                                }
                            }]
                        }
                    }
                ],
                update: [
                    {
                        kind: "Update",
                        root: GLOBAL,
                        level: [{kind: 'String', value: "l1"}, {kind: "String", value: "l2"}, {kind: "Int", value: 0}],
                        operation: {kind: "String", value: "ow"}
                    },
                    {
                        kind: "Return",
                        value: {
                            kind: "Selection",
                            root: GLOBAL,
                            level: [{kind: 'String', value: "l1"}, {kind: "String", value: "l2"}, {kind: "Int", value: 0}]
                        }
                    }
                ]
            },
            async server => {
                expect(await server.init()).toBeNull()
                expect(await server.update()).toEqual("ow")
            },
            ["storage"]
        )
    )

    describe("iterations", () => {
        it("can iterate over local arrays", () => {
            withInputHarness(
                [],
                {
                    sum: {
                        input: [{kind: "Array", data: [{kind: "double", data: null}]}],
                        computation: [
                            {
                                kind: "Save",
                                value: {kind: "Int", value: 0},
                            },
                            {
                                kind: "ArrayForEach", 
                                target: {kind: "Saved", index: 0},
                                do: [
                                    {
                                        kind: "Update",
                                        operation: {
                                            kind: "Math", 
                                            sign: "+", 
                                            left: {kind: "Saved", index: 1},
                                            right: {kind: "Saved", index: 2}
                                        },
                                        level: [],
                                        root: {kind: "Saved", index: 1}
                                    }
                                ]
                            },
                            {
                                kind: "Return", value: {kind: "Saved", index: 1}
                            }
                        ]
                    }
                },
                async server => {
                    expect(await server.sum([1, 2, 3])).toBe(6)
                }
            )
        })
    })

    

    describe("race condition possible actions", () => {
        it("can perform updates that depend on global state", noInputHarness(
            {
                get, 
                set,
                setToSelfPlusOne: [{
                    kind: "Update",
                    root: GLOBAL,
                    level: [{kind: "String", value: "l1"}, {kind: "String", value: "l2"}],
                    operation: {
                        kind: "Math",
                        left: {
                            kind: "Selection", 
                            root: GLOBAL,
                            level: [{kind: "String", value: "l1"}, {kind: "String", value: "l2"}]
                        },
                        right: {kind: "Int", value: 1},
                        sign: "+"
                    }
                }]
            },
            async server => {
                expect(await server.set()).toBeNull()
                expect(await server.setToSelfPlusOne()).toBeNull()
                expect(await server.get()).toEqual({l2: 43})
            }, ["storage"])
        )

        it("can perform updates that depend on global state - ifs", noInputHarness(
            {
                get, 
                set,
                setTo0If42: [
                    {
                        kind: "If",
                        conditionally: [
                            {
                                kind: "Conditional",
                                cond: {kind: "FieldExists", field: {kind: "String", value: "l1"}, value: GLOBAL},
                                do: [{
                                    kind: "Update",
                                    root: GLOBAL,
                                    level: [{kind: "String", value: "l1"}, {kind: "String", value: "l2"}],
                                    operation: {kind: "Int", value: 0}
                                }]
                            }
                        ]
                    }
                ]
            },
            async server => {
                expect(await server.set()).toBeNull()
                expect(await server.setTo0If42()).toBeNull()
                expect(await server.get()).toEqual({l2: 0})
            }, ["storage"])
        )

        it("mutation conditional on same global state requires lock", noInputHarness(
            {
                get, 
                set,
                setTo0If42: [
                    {
                        kind: "If",
                        conditionally: [
                            {
                                kind: "Conditional",
                                cond: {
                                    kind:  "BoolAlg", sign: "and", 
                                    left: {kind: "FieldExists", field: {kind: "String", value: "l1"}, value: GLOBAL},
                                    right: {kind: "Bool", value: false}
                                },
                                do: [{kind: "Return"}]
                            },
                            {
                                kind: "Finally",
                                do: [{
                                    kind: "Update",
                                    root: GLOBAL,
                                    level: [{kind: "String", value: "l1"}, {kind: "String", value: "l2"}],
                                    operation: {kind: "Int", value: 0}
                                }]
                            }
                        ]
                    }
                ]
            },
            async server => {
                expect(await server.set()).toBeNull()
                expect(await server.setTo0If42()).toBeNull()
                expect(await server.get()).toEqual({l2: 0})
            }, ["storage"])
        )

        it("can perform updates that depend on some other global state", noInputHarness(
            {
                get, 
                setOther: [{
                    kind: "Update", 
                    root: {kind: "GlobalObject", name: "other"}, 
                    level: [{kind: "String", value: "l1"}],
                    operation: {kind: "Int", value: 734}
                }],
                setToOtherPlusOne: [{
                    kind: "Update",
                    root: GLOBAL,
                    level: [{kind: "String", value: "l1"}],
                    operation: {
                        kind: "Math",
                        left: {
                            kind: "Selection", 
                            root: {kind: "GlobalObject", name: "other"},
                            level: [{kind: "String", value: "l1"}]
                        },
                        right: {kind: "Int", value: 1},
                        sign: "+"
                    }
                }]
            },
            async server => {
                expect(await server.setOther()).toBeNull()
                expect(await server.setToOtherPlusOne()).toBeNull()
                expect(await server.get()).toBe(735)
            }, ["storage"])
        )


        it("can perform updates that depend on global state transitively", noInputHarness(
            {
                get, 
                set,
                setToSelfPlusOne: [
                    {
                        kind: "Save",
                        value: {
                            kind: "Selection", 
                            root: GLOBAL,
                            level: [{kind: "String", value: "l1"}, {kind: "String", value: "l2"}]
                        }
                    },
                    {
                    kind: "Update",
                    root: GLOBAL,
                    level: [{kind: "String", value: "l1"}, {kind: "String", value: "l2"}],
                    operation: {
                        kind: "Math",
                        left: {kind: "Saved", index: 0},
                        right: {kind: "Int", value: 1},
                        sign: "+"
                    }
                }]
            },
            async server => {
                expect(await server.set()).toBeNull()
                expect(await server.setToSelfPlusOne()).toBeNull()
                expect(await server.get()).toEqual({l2: 43})
            }, ["storage"])
        )

        it("global state taint is transitive through variables", noInputHarness(
            {
                get, 
                set,
                setToSelfPlusOne: [
                    {
                        kind: "Save",
                        value: {
                            kind: "Selection", 
                            root: GLOBAL,
                            level: [{kind: "String", value: "l1"}, {kind: "String", value: "l2"}]
                        }
                    },
                    {
                        kind: "Save",
                        value: {kind: "Saved", index: 0}
                    },
                    {
                    kind: "Update",
                    root: GLOBAL,
                    level: [{kind: "String", value: "l1"}, {kind: "String", value: "l2"}],
                    operation: {
                        kind: "Math",
                        left: {kind: "Saved", index: 1},
                        right: {kind: "Int", value: 1},
                        sign: "+"
                    }
                }]
            },
            async server => {
                expect(await server.set()).toBeNull()
                expect(await server.setToSelfPlusOne()).toBeNull()
                expect(await server.get()).toEqual({l2: 43})
            }, ["storage"])
        )

        it("global state taint is applied on updates to variables", noInputHarness(
            {
                get, 
                set,
                setToSelfPlusOne: [
                    {
                        kind: "Save",
                        value: {kind: "Int", value: 0}
                    },
                    {
                        kind: "Update", 
                        root: {kind: "Saved", index: 0},
                        level: [],
                        operation: {
                            kind: "Selection", 
                            root: GLOBAL,
                            level: [{kind: "String", value: "l1"}, {kind: "String", value: "l2"}]
                        },
                    },
                    {
                    kind: "Update",
                    root: GLOBAL,
                    level: [{kind: "String", value: "l1"}, {kind: "String", value: "l2"}],
                    operation: {
                        kind: "Math",
                        left: {kind: "Saved", index: 0},
                        right: {kind: "Int", value: 1},
                        sign: "+"
                    }
                }]
            },
            async server => {
                expect(await server.set()).toBeNull()
                expect(await server.setToSelfPlusOne()).toBeNull()
                expect(await server.get()).toEqual({l2: 43})
            }, ["storage"])
        )

        it("iterating over an array of globals while writing requires a lock", noInputHarness({
            get,
            set,
            setLookupKeys: [
                {
                    kind: "Update",
                    level: [{kind: "String", value: "arr"}],
                    operation: {kind: "ArrayLiteral", values: [{kind: "String", value: "l1"}]},
                    root: GLOBAL
                }
            ],
            deleteLookupFields: [
                {
                    kind: "ArrayForEach",
                    target: {
                        kind: "Selection", 
                        root: GLOBAL,
                        level: [{kind: "String", value: "arr"}]
                    },
                    do: [
                        {
                            kind: "Update", 
                            root: GLOBAL,
                            level: [{kind: "String", value: "l1"}],
                            operation: {kind: "DeleteField"}
                        }
                    ]
                }
            ]
        },
        async server => {
            expect(await server.set()).toBeNull()
            expect(await server.setLookupKeys()).toBeNull()
            expect(await server.deleteLookupFields()).toBeNull()
            expect(await server.get()).toBeNull()
        }, ["storage"])
        )
        
        const create_user: FunctionData = {
            "computation": [
                {
                    "conditionally": [
                        {
                            "cond": {
                                "kind": "Comparison",
                                "left": {
                                    "kind": "Selection",
                                    "level": [
                                        {
                                            "index": 0,
                                            "kind": "Saved"
                                        }
                                    ],
                                    "root": {
                                        "kind": "GlobalObject",
                                        "name": "users"
                                    }
                                },
                                "right": {
                                    "kind": "None"
                                },
                                "sign": "!="
                            },
                            "do": [
                                {
                                    "kind": "Return",
                                    "value": {
                                        "kind": "String",
                                        "value": "user already exists"
                                    }
                                }
                            ],
                            "kind": "Conditional"
                        }
                    ],
                    "kind": "If"
                },
                {
                    "kind": "Update",
                    "level": [
                        {
                            "index": 0,
                            "kind": "Saved"
                        }
                    ],
                    "operation": {
                        "fields": [
                            {
                                "key": {
                                    "kind": "String",
                                    "value": "chats"
                                },
                                "kind": "Field",
                                "value": {
                                    "kind": "ArrayLiteral",
                                    "values": []
                                }
                            }
                        ],
                        "kind": "Object"
                    },
                    "root": {
                        "kind": "GlobalObject",
                        "name": "users"
                    }
                },
                {
                    "kind": "Return",
                    "value": {
                        "kind": "String",
                        "value": "user created"
                    }
                }
            ],
            "input": [
                {
                    "data": null,
                    "kind": "string"
                }
            ]
        }

        const get_user: FunctionData = {
            "computation": [
                {
                    "kind": "Return",
                    "value": {
                        "fields": [
                            {
                                "key": {
                                    "kind": "String",
                                    "value": "exists"
                                },
                                "kind": "Field",
                                "value": {
                                    "kind": "Comparison",
                                    "left": {
                                        "kind": "Selection",
                                        "level": [
                                            {
                                                "index": 0,
                                                "kind": "Saved"
                                            }
                                        ],
                                        "root": {
                                            "kind": "GlobalObject",
                                            "name": "users"
                                        }
                                    },
                                    "right": {
                                        "kind": "None"
                                    },
                                    "sign": "!="
                                }
                            },
                            {
                                "key": {
                                    "kind": "String",
                                    "value": "val"
                                },
                                "kind": "Field",
                                "value": {
                                    "kind": "Selection",
                                    "level": [
                                        {
                                            "index": 0,
                                            "kind": "Saved"
                                        }
                                    ],
                                    "root": {
                                        "kind": "GlobalObject",
                                        "name": "users"
                                    }
                                }
                            }
                        ],
                        "kind": "Object"
                    }
                }
            ],
            "input": [
                {
                    "data": null,
                    "kind": "string"
                }
            ]
        }
        

        it("should allow checks of existence with comparisons to none", withInputHarness(["storage"],
        {
            get_user,
            create_user            
        },
        
        async server => {
            expect(await server.get_user("me")).toEqual({exists: false, val: null})
            expect(await server.create_user("me")).toEqual("user created")
            expect(await server.create_user("me")).toEqual("user already exists")
            expect(await server.get_user("me")).toEqual({exists: true, val: {chats: []}})
        }))

        it("pushing then returning", withInputHarness(["storage"], 
        {
            push: {
                input: [{kind: "string", data: null}, {kind: "Any", data: null}],

                computation: [
                    {
                        kind: "Update", 
                        root: GLOBAL, 
                        level: [{kind:"Saved",index: 0}], 
                        operation: {kind: "Object", fields: [{kind: "Field", key: {kind: "String", value: "k1"}, value: {kind: "ArrayLiteral", values: []}}]}
                    },
                    {
                        kind: "ArrayForEach",
                        target: {kind: "Saved", index: 1},
                        do: [
                            {
                                kind: "Update", 
                                root: GLOBAL, 
                                level: [{kind:"Saved",index: 2}, {kind: "String", value: "k1"}], 
                                operation: {kind: "Push", values: [
                                    {kind: "Saved", index: 0}
                                ]}
                            },        
                        ]
                    },
                    {
                        kind: "Return", value: {kind: "String", value: "done"}
                    }
                ]
            }

        },
        async server => {
            expect(await server.push("key1", ["key1"])).toEqual("done")
        }))

        it("global state taint is applied on partial updates to variables", noInputHarness(
            {
                get, 
                set,
                updateWithPartialState: [
                    {
                        kind: "Save",
                        value: {kind: "Object", fields: [{
                            kind: "Field",
                            value: {
                                kind: "Selection", 
                                root: GLOBAL,
                                level: [{kind: "String", value: "l1"}]
                            },
                            key: {kind: "String", value: "global_origin"}
                        }]}
                    },
                    {
                        kind: "Update", 
                        root: {kind: "Saved", index: 0},
                        level: [{kind: "String",value: "clean"}],
                        operation: {kind: "Int", value: 12},
                    },
                    {
                        kind: "Update",
                        root: GLOBAL,
                        level: [{kind: "String", value: "l1"}],
                        operation: {kind: "Saved", index: 0}
                    }
                ]
            },
            async server => {
                expect(await server.set()).toBeNull()
                expect(await server.updateWithPartialState()).toBeNull()
                expect(await server.get()).toEqual({clean: 12, global_origin: {l2: 42}})
            }, ["storage"])
        )

        it("global state taint is erased on overwrites", noInputHarness(
            {
                get, 
                set,
                updateWithOverwrittenState: [
                    {
                        kind: "Save",
                        value: {kind: "Object", fields: [{
                            kind: "Field",
                            value: {
                                kind: "Selection", 
                                root: GLOBAL,
                                level: [{kind: "String", value: "l1"}]
                            },
                            key: {kind: "String", value: "global_origin"}
                        }]}
                    },
                    {
                        kind: "Update", 
                        root: {kind: "Saved", index: 0},
                        level: [],
                        operation: {kind: "Int", value: 0},
                    },
                    {
                        kind: "Update",
                        root: GLOBAL,
                        level: [{kind: "String", value: "l1"}],
                        operation: {kind: "Saved", index: 0}
                }]
            },
            async server => {
                expect(await server.set()).toBeNull()
                expect(await server.updateWithOverwrittenState()).toBeNull()
                expect(await server.get()).toEqual(0)
            }, ["storage"])
        )
    })

    describe("strings", () => {
        it("allows concatenation with some types", withInputHarness([],
        {
            add: {
                input: [{kind: "Any", data: null}, {kind: "Any", data: null}],
                computation: [
                    {
                        kind: "Return",
                        value: {
                            kind: 'Math',
                            left: {kind: "Saved", index: 0},
                            right: {kind: 'Saved', index: 1},
                            sign: "+"
                        }
                    }
                ]
            }
        },
        async server => {
            const tests: {l: string | number, r: string |number, e: string}[] = [
                {l: "a", r: "B", e: "aB"},
                {l: "a", r: 1, e: "a1"},
                {l: "a", r: 1.1, e: "a1.1"},
                {l: 1, r: "a", e: "1a"},
                {l: 1.1, r: "a", e: "1.1a"}
            ]
            
            const res: Promise<void>[] = tests.map(t => server.add(t.l, t.r).then(result => {
                expect(result).toBe(t.e)
            }))
            await Promise.all(res)
        }
        ))
    })
    describe.skip("Locks", () => {
        it("locks prevent progress if not held", withInputHarness(
            ["storage", "locks"],
            {
                unsafeGet: {
                    computation: [
                    {kind: "Return", value: {
                        kind: "Selection",
                        level: [{kind: "String", value: "data"}],
                        root: GLOBAL
                    }}
                    ],
                    input: []
                },
                unsafeSet: {
                    computation: [
                        {
                            kind: "Update",
                            root: GLOBAL,
                            level: [{kind: "String", value: "data"}],
                            operation: {kind: "Saved", index: 0}
                        },
                    ],
                    input: [{kind: "int", data: null}]
                },
                incr: {
                    computation: [
                        {kind: "Lock", name: {kind: "String", value: 'lock'}},
                        {kind: "Call", function_name: "unsafeSet", args: [
                            {
                                kind: "Math", 
                                left: {kind: "Call", function_name: "unsafeGet", args: []},
                                right: {kind: "Int", value: 1},
                                sign: "+"
                            }
                        ]},
                        {kind: "Release", name: {kind: "String", value: 'lock'}}
                    ],
                    input: []
                }
            },
            async server => {
                expect(await server.unsafeSet(0)).toBeNull()
                expect(await server.unsafeGet()).toBe(0)
                const incrs: Promise<void>[] = []
                for (let i = 0; i < 100; i++) {
                    incrs.push(server.incr())
                }
    
                await Promise.all(incrs)
                expect(await server.unsafeGet()).toBe(100)
            }
        ), 10000)
    })
})


