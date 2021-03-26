import { ow } from './index';
import { StrongServerEnv } from './env';
import * as ed from 'noble-ed25519';
import { Test } from "./local_run/utilities";
import * as bind from '../ops/bindings'
describe("conduit kernel", () => {
  function kernelTest(
    descr: string,
    test: (server: Test.Server) => Promise<void>,
    envOverride: Partial<StrongServerEnv> = {},
    only?: "only"
  ) {
    
    const tester: jest.It = only ? it.only : it
    tester(
      descr,
      async () => {
        const key = ed.utils.randomPrivateKey()
        const pub = await ed.getPublicKey(key)
        
        const env: StrongServerEnv = {
          PROCEDURES: {},
          STORES: {},
          SCHEMAS: {},
          DEPLOYMENT_NAME: "testdeployment",
          PRIVATE_KEY:  new Uint8Array([...key, ...pub]),
          PUBLIC_KEY: pub
        };
        for (const key in envOverride) {
          //@ts-ignore
          env[key] = envOverride[key];
        }
        const server = await Test.Server.start(env);
        await test(server);
        server.kill();
      },
      10000
    );
  }

  describe("noop server", () => {
    kernelTest("should be able to do nothing", async () => {});
  });

  describe("procedures", () => {
    kernelTest(
      "invoking a custom noop",
      async (server) => {
        const res = await server.invoke("customNoop");
        expect(res).toEqual(null);
      },
      { PROCEDURES: { customNoop: [{kind: "noop", data: null}] } }
    );

    kernelTest(
      "destructuring an object",
      async (server) => {
        const res = await server.invoke("destructure");
        expect(res).toEqual("target field");
      },
      {
        PROCEDURES: {
          destructure: [
            ow.instantiate({ f: { o: { o: "target field" } } }),
            ow.extractFields([["f", "o", "o"]]),
            ow.returnStackTop,
          ],
        },
      }
    );

    kernelTest(
      "cannot invoke private functions",
      async server => {
        expect(await server.invoke("echo", "hello")).toBeNull()
      },
      {
        PROCEDURES: {echo: [ow.returnVariable(0)]},
        PRIVATE_PROCEDURES: ["echo"]
      }
    )
    kernelTest(
      "can use a get to call functions",
      async server => {
        const result = await fetch(`http://localhost:${server.port}/returner?foo=bar&fix=12&a.b=1&a.c=2`, {
          method: "GET",
          headers: {
            "content-type": "application/json",
          },
        })
        expect(await result.json()).toEqual({foo: "bar", fix: "12", "a.b": "1", "a.c": "2"})
      },
      {
        PROCEDURES: {returner: [ow.returnVariable(0)]},
      },
    )
    kernelTest(
      "can use post to call functions",
      async server => {
        
        const orig = {a: "12", b: {c: 12}}
        const body = JSON.stringify(orig)
        const result = await fetch(`http://localhost:${server.port}/returner`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": `${body.length}`,
          },
          body
        })
        expect(await result.json()).toEqual(orig)
      },
      {
        PROCEDURES: {returner: [ow.returnVariable(0)]},
      },
    )

    kernelTest(
      "functions can invoke other functions",
      async server => {
        expect(await server.invoke("callsEcho", "hi")).toEqual("hi")
        expect(await server.invoke("callsNoop")).toEqual("hi")
      },
      {
        PROCEDURES: {
          echo: [ow.returnVariable(0)],
          noop: [ow.noop],
          callsEcho: [ow.copyFromHeap(0), ow.invoke({name: "echo", args: 1}), ow.returnStackTop],
          callsNoop: [ow.invoke({name: "noop", args: 0}), ow.instantiate("hi"), ow.returnStackTop]
        },
        PRIVATE_PROCEDURES: ["echo"]
      },
    )
    kernelTest(
      "math",
      async (server) => {
        expect(await server.invoke("plus")).toBe(42);
        expect(await server.invoke("minus")).toBe(-0.5);
        expect(await server.invoke("divide")).toBe(-0.125);
      },
      {
        PROCEDURES: {
          plus: [
            ow.instantiate(1),
            ow.instantiate(41),
            ow.plus,
            ow.returnStackTop,
          ],
          minus: [
            ow.instantiate(0.5),
            ow.instantiate(1),
            ow.nMinus,
            ow.returnStackTop,
          ],
          divide: [
            ow.instantiate(-0.5),
            ow.instantiate(4),
            ow.nDivide,
            ow.returnStackTop,
          ],
        },
      }
    );

    kernelTest(
      "deleting on local objects",
      async (server) => {
        expect(
          await server.invoke("delete", {
            l1: { l2: "delete me", other: "hi" },
          })
        ).toMatchInlineSnapshot(`
          Object {
            "l1": Object {
              "other": "hi",
            },
          }
        `);
      },
      {
        PROCEDURES: {
          delete: [
            
            ow.instantiate("l1"),
            ow.instantiate("l2"),
            ow.deleteSavedField({ field_depth: 2, index: 0}),
            ow.returnVariable(0),
          ],
        },
      }
    );
  });

  describe("schema", () => {
    function schemaTest(
      descr: string,
      allowsNone: "can be none" | "must exist",
      invalidInput: bind.InterpreterType,
      validInput: bind.InterpreterType,
      schema: bind.Schema
    ) {
      kernelTest(
        `schema test: ${descr}`,
        async (server) => {
          if (allowsNone === "must exist") {
            expect(await server.invoke("validateSchema", [null])).toBeFalsy();
          }

          expect(
            await server.invoke("validateSchema", invalidInput)
          ).toBeFalsy();
          expect(
            await server.invoke("validateSchema", validInput)
          ).toBeTruthy();
        },
        {
          PROCEDURES: {
            validateSchema: [
              ow.enforceSchemaOnHeap({ schema: "schema", heap_pos: 0 }),
              ow.returnStackTop,
            ],
          },
          SCHEMAS: {schema},
        }
      );
    }

    kernelTest(
      "input args test",
      async (server) => {
        expect(await server.invoke("test", true, 42, 12)).toBeTruthy();
        expect(await server.invoke("test", 42, false, "abc")).toBeFalsy();
      },
      {
        PROCEDURES: {
          test: [
            ow.enforceSchemaInstanceOnHeap({
              heap_pos: 0,
              schema: {kind: "bool", data: null},
            }),
            ow.enforceSchemaInstanceOnHeap({
              heap_pos: 1,
              schema: {kind: "int", data: null},
            }),
            ow.enforceSchemaInstanceOnHeap({
              heap_pos: 2,
              schema: {kind: "Any", data: null},
            }),
            ow.boolAnd,
            ow.boolAnd,
            ow.returnStackTop,
          ],
        },
      }
    );

    schemaTest(
      "boolean",
      "must exist",
      12,
      true,
      {kind: "bool", data: null}
    );

    schemaTest(
      "required union",
      "must exist",
      [{foo: "hi"}, {bar: 12}],
      [{foo: 12}, {bar: "hi"}],
      {kind: "Array", data: [
        {kind: "Union", data: [
          {kind: "Object", data: {foo: {kind: "int", data: null}}},
          {kind: "Object", data: {bar: {kind: "string", data: null}}},
        ]}
      ]}
    )

    schemaTest(
      "union with optional",
      "can be none",      
      {bar: "hi"},
      {foo: "hi"},
      {
        kind: "Union",
        data: [
          {kind: "Object", data: {foo: {kind: "Union", data: [{kind: "int", data: null}, {kind: "string", data: null}]}}},
          {kind: "none", data: null}
        ]
      }
    )

    kernelTest("recursive types", 
      async server => {
        expect(await server.invoke("validate", {
          child: {child: {child: {child: null}}} 
        })).toBeTruthy()
        expect(await server.invoke("validate", null)).toBeTruthy()
        expect(await server.invoke("validate", {child: {left: {}, right: {}}})).toBeFalsy()
      },
      {
        SCHEMAS: {
          node: {kind: "Union", data: [
            {kind: "Object", data: {child: {kind: "TypeAlias", data: "node"}}},
            {kind: "none", data: null}
          ]}
        },
        PROCEDURES: {
          validate: [ow.enforceSchemaOnHeap({schema: "node", heap_pos: 0}), ow.returnStackTop]
        }
      }
    )
    schemaTest(
      "decimal",
      "must exist",
      "-1",
      12.12,
      {kind: "double", data: null},
    );
    schemaTest(
      "decimal vs string",
      "must exist",
      "0.1",
      0.1,
      {kind: "double", data: null}
    );
    schemaTest(
      "Optional double but received none",
      "can be none",
      true,
      null,
      {kind: "Union", data: [{kind: "double", data: null,}, {kind: "none", data: null}]}
    );
    schemaTest(
      "array is empty",
      "must exist",
      null,
      [],
      {kind: "Array", data: [{kind: "int", data: null}]}
    );
    schemaTest(
      "array tail is invalid",
      "must exist",
      [12, "abc"],
      [12],
      {kind: "Array", data: [{kind: "int", data: null}]}
    );
    schemaTest(
      "ints may be treated as doubles",
      "must exist",
      "1",
      132,
      {kind: "double", data: null}
    );

    schemaTest("map types",
      "must exist",
      {foo: "string", baz: 12},
      {foo: "string", bar: "also string"},
      {kind: "Map", data: [{kind: "string", data: null}]}
    )

    schemaTest(
      "doubles may not be treated as ints",
      "must exist",
      0.1,
      1,
      {kind: "int", data: null}
    );
    schemaTest(
      "Object containing primitives",
      "must exist",
      {},
      { i: 12, d: 12.12, b: true, s: "hello" },
      {kind: "Object", data: {
        i: {kind: "int", data: null},
        d: {kind: "double", data: null},
        b: {kind: "bool", data: null},
        s: {kind: "string", data: null}
      }}
    );
    schemaTest(
      "Object containing optional field doesn't exist",
      "must exist",
      { i: "abc" },
      {},
      {kind: "Object", data: {
        i: {kind: "Union", data: [
          {kind: "none", data: null},
          {kind: "int", data: null}
        ]}
      }}
    );
    schemaTest(
      "Object containing unspecified field is not allowed",
      "must exist",
      {},
      { i: 12},
      {kind: "Object", data: {i: {kind: "int", data: null}}}
    );

    schemaTest(
      "Optionals don't mean you can add other fields",
      "must exist",
      { d: [12, 12] },
      {},
      {kind: "Object", data: {
        i: {kind: "Union", data: [
          {kind: "none", data: null},
          {kind: "int", data: null}
        ]}
      }}
    );

    schemaTest(
      "Object containing optional object",
      "must exist",
      null,
      {
        o: {f: 12}
      },
      {
        kind: "Object",
        data: {o: {kind: "Object", data: {f: {kind: "int", data:null}}}}
      }
    );

    kernelTest("Role schemas should be signed",
      async server => {
        const validRole = await server.invoke("getRole", {_name: "admin"})
        expect(await server.invoke("validateRole", {})).toBe(false)
        expect(await server.invoke("validateRole", {_name: "admin"})).toBe(false)
        expect(await server.invoke("validateRole", validRole)).toBe(true)
        expect(await server.invoke("validateRole", {_name: "something else"})).toBe(false)
      
        const priv = ed.utils.randomPrivateKey()
        const pub = await ed.getPublicKey(priv)
        const _sig = await ed.sign("admin", priv)
        expect(await ed.verify(_sig, "admin", pub)).toBe(true)
        const impersonator = {
          _name: 'admin',
          _sig
        }
        expect(await server.invoke("validateRole", impersonator)).toBe(false)
      }, {
        PROCEDURES: {
          getRole: [
            ow.copyFromHeap(0),
            ow.signRole,
            ow.returnStackTop
          ],
          validateRole: [
            ow.enforceSchemaInstanceOnHeap({
              heap_pos: 0,
              schema: {kind: "Role", data: ["admin", [{kind: "Object", data: {}}]]}
            }),
            ow.returnStackTop
          ]
        }
    })

    kernelTest("Roles can contain state",
      async server => {
        // Both adheres to state and is signed.
        const validRole = await server.invoke("getRole", {_name: "admin", _state: {some_state: "hello"}})

        // State is not necessary to sign. State is only checked on validation.
        const stateless1 = await server.invoke("getRole", {_name: "admin", _state: {}})
        const stateless2 = await server.invoke("getRole", {_name: "admin"})
        expect(await server.invoke("validateRole", stateless1)).toBeFalsy()
        expect(await server.invoke("validateRole", stateless2)).toBeFalsy()
        
        expect(await server.invoke("validateRole", {})).toBe(false)
        expect(await server.invoke("validateRole", {_name: "admin"})).toBe(false)
        expect(await server.invoke("validateRole", validRole)).toBe(true)
        expect(await server.invoke("validateRole", {_name: "admin", _state: {}, _sig: []})).toBe(false)
              
        const switched_state = {
          ...validRole,
          _state: {some_state: "bye"}
        }
        expect(await server.invoke("validateRole", switched_state)).toBe(false)
      }, {
        PROCEDURES: {
          getRole: [
            ow.copyFromHeap(0),
            ow.signRole,
            ow.returnStackTop
          ],
          validateRole: [
            ow.enforceSchemaInstanceOnHeap({
              heap_pos: 0, 
              schema: {kind: "Role", data: ["admin",[ {kind: "Object", data: {some_state: {kind: "string", data: null}}}]]}
            }),
            ow.returnStackTop
          ]
        }
    })
  });
  type bsonType = "object" | "string" | "long" | "array" | "bool" | "double";
  type ObjectReqs = {
    required: string[];
    properties: Record<string, MongoSchema>;
  };
  type MongoSchema =
    | ({ bsonType: "object" } & ObjectReqs)
    | { bsonType: "string" }
    | { bsonType: "long" }
    | { bsonType: "array"; items: MongoSchema }
    | {
        bsonType: [Exclude<bsonType, "object" | "array">];
      }
    | ({
        bsonType: ["object"];
      } & ObjectReqs)
    | { bsonType: "bool" }
    | { bsonType: "double" };

  describe("mongo storage layer", () => {
    function storageTest(
      descr: string,
      params: Pick<StrongServerEnv, "STORES" | "PROCEDURES">,
      test: (server: Test.Server) => Promise<void>,
      only = false
    ) {
      let tester = only ? it.only : it;

      tester(
        descr,
        async () =>
        
          Test.Mongo.start(params).then(async (mongo) => {
            const key = ed.utils.randomPrivateKey(64)

            return Test.Server.start({
              MONGO_CONNECTION_URI: `mongodb://localhost:${mongo.port}`,
              ...params,
              SCHEMAS: {},
              DEPLOYMENT_NAME: "statefultest",
              PUBLIC_KEY: (await ed.getPublicKey(key)),
              PRIVATE_KEY: key
            })
            .then((server) => test(server).finally(() => server.kill()))
            .finally(() => mongo.kill())
          }),
        15000
      );
    }

    storageTest(
      "should be able to store a document",
      {
        STORES: {
          storeName: {
            kind: "Object",
            data: {
              int: {kind: "int", data: null},
              opt: {kind: "Union", data: [
                {kind: "Array", data: [{kind: "Object", data: {b: {kind: "bool", data: null}}}]},
                {kind: "none", data: null}
              ]}
            }
          }
        },
        PROCEDURES: {
          testStore: [
            ow.insertFromHeap({ heap_pos: 0, store: "storeName" }),
            ow.getAllFromStore("storeName"),
            ow.returnStackTop,
          ],
        },
      },
      async (server) => {
        const res = await server.invoke(
          "testStore",
          {int: 12, opt: null}
        );
        expect(res).toMatchInlineSnapshot(`
          Array [
            Object {
              "int": 12,
              "opt": null,
            },
          ]
        `);
      }
    );

    storageTest(
      "should be able to suppress fields in a query",
      {
        STORES: {
          storeName: {kind: "Object", data: {
            left: {kind: "int", data: null},
            right: {kind: "int", data: null}
          }}
        },
        PROCEDURES: {
          testStore: [
            ow.insertFromHeap({ heap_pos: 0, store: "storeName" }),
            ow.instantiate({}), // Filter for query
            ow.queryStore(["storeName", { right: false }]),
            ow.returnStackTop,
          ],
        },
      },
      async (server) => {
        const res = await server.invoke(
          "testStore",
          {
            left: -1,
            right: 1
          }
        );
        expect(res).toEqual([{ left: -1 }]);
      }
    );
    storageTest(
      "should be able to filter strings in query",
      {
        STORES: {
          strings: {kind: "Object", data: {value: {kind: "string", data: null}}}
        },
        PROCEDURES: {
          insert: [
            ow.instantiate([{ value: "a" }, { value: "b" }]),
            ow.insertFromStack("strings"),
            ow.instantiate(true),
            ow.returnStackTop,
          ],
          getBs: [
            ow.instantiate({ value: "b" }),
            ow.queryStore(["strings", {}]),
            ow.returnStackTop,
          ],
        },
      },
      async (server) => {
        expect(await server.invoke("insert")).toBeTruthy();
        expect(await server.invoke("insert")).toBeTruthy();
        expect(await server.invoke("getBs")).toEqual([
          { value: "b" },
          { value: "b" },
        ]);
      }
    );

    storageTest(
      "should be able to filter numbers in query",
      {
        STORES: {
          nums: {kind: "Object", data: {value: {kind: "int", data: null}}},
        },
        PROCEDURES: {
          insert: [
            ow.instantiate([{ value: 1 }, { value: 2 }]),
            ow.insertFromStack("nums"),
            ow.instantiate(true),
            ow.returnStackTop,
          ],
          getLte: [
            ow.instantiate({ value: { $lte: {} } }),
            ow.copyFromHeap(0),
            ow.setNestedField(["value", "$lte"]),
            ow.queryStore(["nums", {}]),
            ow.returnStackTop,
          ],
        },
      },
      async (server) => {
        expect(await server.invoke("insert")).toBeTruthy();
        expect(await server.invoke("getLte", 2)).toEqual([
          { value: 1 },
          { value: 2 },
        ]);
        expect(await server.invoke("getLte", 1)).toEqual([{ value: 1 }]);
      }
    );

    storageTest(
      "find one",
      {
        STORES: {
          users: {kind:  "Object", data: {
            email: {kind: "string", data: null},
            pwd: {kind: "string", data: null}
          }}
        },
        PROCEDURES: {
          addUser: [
            ow.insertFromHeap({ heap_pos: 0, store: "users" }),
            ow.returnVariable(0),
          ],
          getUser: [
            ow.instantiate({}),
            ow.copyFromHeap(0),
            ow.assignPreviousToField("email"),
            ow.findOneInStore(["users", {}]),
            ow.returnStackTop,
          ],
        },
      },
      async (server) => {
        const user = { email: "a@gmail.com", pwd: "password" };
        expect(await server.invoke("addUser", user)).toBeTruthy();
        expect(await server.invoke("getUser", user.email)).toEqual(user);
        expect(await server.invoke("getUser", "someoneelse")).toBeNull();
      }
    );

    storageTest(
      "should be able to suppress objects in a query",
      {
        STORES: {
          storeName: {kind: "Any", data: null},
        },
        PROCEDURES: {
          testStore: [
            ow.insertFromHeap({ heap_pos: 0, store: "storeName" }),
            ow.instantiate({}), //filter for query
            ow.queryStore(["storeName", { right: false }]),
            ow.returnStackTop,
          ],
        },
      },
      async (server) => {
        const res = await server.invoke(
          "testStore",
          {
            left: {a: true, b: false},
            right: {c: false}
          }
        );
        expect(res).toEqual([{ left: { a: true, b: false } }]);
      }
    );

    const insert = [ow.insertFromHeap({ heap_pos: 0, store: "test" })];

    const len = [ow.instantiate({}), ow.storeLen("test"), ow.returnStackTop];
    const STORES: Record<string, bind.Schema> = {
      test: {kind: "Object", data: {test: {kind: "string", data: null}}},
    };

    storageTest(
      "measure global store",
      { STORES, PROCEDURES: { len, insert } },
      async (server) => {
        expect(
          await server.invoke("insert", [{ data: "first" }, { data: "second" }])
        ).toBeNull();
        expect(await server.invoke("len")).toBe(2);
      }
    );

    storageTest("should be able to delete fields an existing document", 
      {
        STORES: {storeName: {kind: 'Any', data: null}},
        PROCEDURES: {
          insert: [ow.instantiate([{f1: 1, f2: 2}, {f1: 3, f2: 4}]), ow.insertFromStack("storeName")],
          deletes: [
            ow.instantiate({f1: 1}), 
            ow.deleteOneInStore("storeName"), 
            ow.instantiate({"$unset": {f2: ""}}), // Drop the f2 on the second doc.
            ow.instantiate({f1: 3}), // Query for the drop
            ow.updateOne({store: "storeName", upsert: false}),
            ow.returnStackTop
          ],
          getAll: [
            ow.getAllFromStore("storeName"),
            ow.returnStackTop
          ]
        }
      },
      async server => {
        expect(await server.invoke("insert")).toBeNull()
        expect(await server.invoke("deletes")).toEqual({f1: 3})
        expect(await server.invoke("getAll")).toEqual([{f1: 3}])
      })
  });

  describe("instructions", () => {
    kernelTest(
      "measuring local arrays",
      async (server) => {
        let len = await server.invoke(
          "measure",
          [0, 1]
        );
        expect(len).toBe(2);
        len = await server.invoke("measure", []);
        expect(len).toBe(0);
      },
      {
        PROCEDURES: {
          measure: [ow.copyFromHeap(0), ow.arrayLen, ow.returnStackTop],
        },
      }
    );

    kernelTest(
      "comparisons",
      async (server) => {
        // Goes in right left order
        const less = await server.invoke("less", [1, 0]);
        const notless = await server.invoke("less", [0, 0]);
        const lessequal = await server.invoke("lesseq", [0, 0]);
        const notlessequal = await server.invoke("lesseq", [0.01, 0.1]);
        const equal = await server.invoke("equal", ["abc", "abc"]);
        const notequal = await server.invoke("notequal", ["abcd", "abc"]);

        expect(less).toBeTruthy();
        expect(notless).toBeFalsy();
        expect(lessequal).toBeTruthy();
        expect(notlessequal).toBeFalsy();
        expect(equal).toBeTruthy();
        expect(notequal).toBeTruthy();
      },
      {
        PROCEDURES: {
          less: [
            ow.copyFromHeap(0),
            ow.flattenArray,
            ow.less,
            ow.returnStackTop,
          ],
          lesseq: [
            ow.copyFromHeap(0),
            ow.flattenArray,
            ow.lesseq,
            ow.returnStackTop,
          ],
          equal: [
            ow.copyFromHeap(0),
            ow.flattenArray,
            ow.equal,
            ow.returnStackTop,
          ],
          notequal: [
            ow.copyFromHeap(0),
            ow.flattenArray,
            ow.equal,
            ow.negatePrev,
            ow.returnStackTop,
          ],
        },
      }
    );

    describe.skip("locks", () => {
      function lockTest(
        test: (server: Test.Server) => Promise<void>,
        envOverride: Partial<StrongServerEnv> = {},
      ): jest.ProvidesCallback {
        return async (cb) => {
          const key = ed.utils.randomPrivateKey(64)
          const env: StrongServerEnv = {
            PROCEDURES: {},
            STORES: {state: {kind: "Any", data: null}},
            SCHEMAS: {},
            DEPLOYMENT_NAME: "testdeployment",
            PRIVATE_KEY: key,
            PUBLIC_KEY: await ed.getPublicKey(key)
            
          };
          for (const key in envOverride) {
            //@ts-ignore
            env[key] = envOverride[key];
          }

          const deps = [
            Test.Mongo.start(env),
            Test.EtcD.start(),
          ]
          const [mongo, etcd] = (await Promise.all(deps)) as [Test.Mongo, Test.EtcD]
          env.MONGO_CONNECTION_URI = `mongodb://localhost:${mongo.port}`
          env.ETCD_URL = `http://localhost:${etcd.port}`
          const server = await Test.Server.start(env);
          await test(server);
          server.kill();
          etcd.kill()
          mongo.kill()
          cb()
        }
      }
      function increment(release: "with release" | "without release"): bind.Op[] {
        return [
          ow.instantiate(0),
          ow.moveStackTopToHeap,
          ow.instantiate("lock_name"),
          ow.lock,
          ow.invoke({name: 'unsafeGet', args: 0}),
          ow.instantiate(1),
          ow.plus,
          ow.invoke({name: "unsafeSet", args: 1}),
          ...release === "with release" ? [
            ow.instantiate("lock_name"),
            ow.release,
          ] :
          [],          
          ow.returnVoid
        ]
      }
      // Disabling locks in this no longer pins the expectation
      // to the number of writes.
      it("locks prevent progress if held elsewhere and are automatically release upon exiting scope",
      lockTest(
      
        async server => {

          await server.invoke("unsafeSet", 0)
          expect(await server.invoke("unsafeGet")).toEqual(0)
          const force_error = () => server.invoke("lockThenFail").catch(() => {})
          const contesting_incr: (() => Promise<void>)[] = [force_error]
          const without_release: (() => Promise<void>)[] = [force_error]
          const num_iterations = 100
          for (let i = 0; i < num_iterations; i++) {
            contesting_incr.push(() =>  server.invoke("incr"))
            without_release.push(() => server.invoke("incrWO"))
          }
          await Promise.all(contesting_incr.map(f => f()))
          await Promise.all(without_release.map(f=> f()))

          expect(await server.invoke("unsafeGet")).toEqual(num_iterations * 2)

        },
        {
          PROCEDURES: {
            
            unsafeSet: [
              ow.instantiate({"$set": {}}),
              ow.instantiate("$set"),
              ow.instantiate("val"),
              ow.copyFromHeap(0),
              ow.setField({field_depth: 2}), // collapse the above into update doc
              ow.instantiate({key: "shared"}), // query doc
              ow.updateOne({store: "state", upsert: true})
            ],
            unsafeGet: [
              ow.getAllFromStore("state"),
              ow.popArray,
              ow.instantiate("val"),
              ow.getField({field_depth: 1}),
              ow.returnStackTop
            ],
            incr: increment("with release"),
            incrWO: increment("without release"),
            lockThenFail: [
              ow.instantiate("lock_name"),
              ow.lock,
              ow.raiseError("uh oh")
            ]
          }
        },
      ), 1000000)
      
    })
  });
});
