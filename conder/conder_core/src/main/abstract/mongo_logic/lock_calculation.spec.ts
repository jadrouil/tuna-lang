import { ActionSequence, calculate_lock_requirements, LockRequirements, Mutation } from "./lock_calculation";

describe("lock calculation", () => {

    class TestActionSet {
        private readonly actions: ActionSequence
        constructor(actions: ActionSequence) {
            this.actions = actions
        }
        expectLocks(expectation: Record<string, "r" | "w">): jest.ProvidesCallback {
            return (cb) => {
                
                expect(calculate_lock_requirements(this.actions)).toEqual(new Map(Object.entries(expectation)))
                cb()    
            }
        }
    }

    function givenActions(actions: ActionSequence): TestActionSet {
        return new TestActionSet(actions)
    }

    const gets: ActionSequence = [
        { kind: "get", id: "i" },
        { kind: "get", id: "i" },
    ]

    it("doesn't require a read lock across multiple gets", 
        givenActions(gets).expectLocks({}))
    
    
    it("doesn't require a lock if a mut is independent of any global state",
        givenActions([new Mutation("i", [])])
        .expectLocks({})
    )
    
    
    // The local view will never be inconsistent.
    // It is a weird use case:
    // g = 1
    // ... do stuff with local state
    // g = 2
    // ... do stuff with local state
    it("doesn't require a lock if a series of mut are independent of any global state",
        givenActions([
                new Mutation("i", []),
                new Mutation("i", []),
                new Mutation("j", [])
            ]
        )
        .expectLocks({})
    )

    it("requires a read lock if a mut is dependent on some other global state", 
        givenActions([new Mutation("i", ["j"])])
        .expectLocks({j: "r"})
    )
    it("requires a write lock if a mut references itself",
        givenActions([new Mutation("i", ["i"])])
        .expectLocks({i: "w"})
    )

    it("doesn't require a write lock if you read a global after writing it",
        givenActions([
            new Mutation("i", []),
            {kind: "get", id: "i"}
        ])
        .expectLocks({})
    )

    it("requires a write lock if a used variable is later mutated", 
        givenActions([
            new Mutation("i", "j"),
            new Mutation("j", [])
        ]).expectLocks({j: "w"})
    )
})
