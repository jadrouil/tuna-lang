import { GraphAnalysis } from "./visitor";

describe("visitor traversal order", () => {
  it("traverses all nodes", () => {
    const before = (n: any, state: string[]) => {
      state.push(
        `Before ${n.kind} ${
          ["number", "string"].includes(typeof n.value) ? n.value : ""
        }`
      );
    };
    const after = (n: any, state: string[]) => {
      state.push(
        `After ${n.kind} ${
          ["number", "string"].includes(typeof n.value) ? n.value : ""
        }`
      );
    };
    const visitor = new GraphAnalysis<string[]>(
      {
        Math: { before, after },
        Int: { before, after },
        Selection: { before, after },
        String: { before, after },
        SetKeyOnObject: { before, after },
      },
      []
    );

    visitor.apply([
      {
        kind: "Math",
        left: { kind: "Int", value: 0 },
        right: { kind: "Int", value: 1111 },
        sign: "+",
      },
      {
        kind: "SetKeyOnObject",
        obj: "global_object",
        value: {
          kind: "Selection",
          root: { kind: "Saved", index: 0 },
          level: [{ kind: "String", value: "get_key" }],
        },
        key: [{ kind: "String", value: "target_key" }],
      },
    ]);
    expect(visitor.state).toMatchInlineSnapshot(`
      Array [
        "Before Math ",
        "Before Int 0",
        "After Int 0",
        "Before Int 1111",
        "After Int 1111",
        "After Math ",
        "Before SetKeyOnObject ",
        "Before String target_key",
        "After String target_key",
        "Before Selection ",
        "Before String get_key",
        "After String get_key",
        "After Selection ",
        "After SetKeyOnObject ",
      ]
    `);
  });
});
