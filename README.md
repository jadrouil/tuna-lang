# Welcome

Tuna is a high-level, gradually-typed, programming language where global state is persisted in database.

# Purpose

The goal of tuna lang is to make it easier to build horizontally scalable and performant systems.

Tuna accomplishes this by providing the same interface to global and local state despite global state being stored in a database. Performance is/will be achieved by building on[conder](https://github.com/Conder-Systems/conder). Conder is a compiler for abstract representations of functions that run mutations/queries against global and local state.

Anyways, the goal is to build a scalable python.

# Getting Started
- The most exhaustive documentation of the syntax can be found in [the compiler tests](tuna-compiler/src/test/language.spec.ts).
- The [cli](tuna/readme.md) has its own getting started.


# Details

## Semantics
Here's a snippet of tuna:

```
const users = {}

pub func add_user(name) {
    users[name] = {}
}
```

Going line by line, `const users = {}`, means there exists a global object called users. It is intitalized empty. Moving on: `pub func add_user(name) ...`. `Pub` in this context means that this function can be called by an external client. To see how functions are invoked, [see](tuna/demos/).

## Primitives

- `int` and `double`. Infix operators: `+ - * /`.
- `string` initalized with single quotes: `'Hello world'`
- `bool` The literals are `true` and `false`.
- `T[]` is an array. T represents the generic type parameter. Initialize like so `[1, 'hi', 2]`.
- `Object` we've seen how these are initialized above. They may also be initialized with fields, similar to javascript.
- `none` None.


## Types

At the moment, types may only be used to describe the inputs of functions and there is no attempt at inference or static type checking.
For example:
```
pub func some_func(a: string, b: int, c: {some_field: b})
```

When `some_func` is invoked by a client, we automatically validate the input match the type. Note, objects are not strictly typed, so if there are more fields required than specified, it will be acceptable. I intend to make this strictness configurable in the future.

### Type Aliases

Type aliases can be defined like they are in typescript: `type my_type = string`.
Note, type aliases may not refer to other type aliases. This is a temporary limitation.

## Locks

Currently, tuna uses mongo under the covers. Mongo doesn't expose locks in their rust driver api, so no locks are acquired, which may make the application unsafe to run. To check if your application is safe you can run the `warn` command with the CLI.


# Limitation Summary
All of the following limitations are temporary:
- Cannot invoke other functions or declare private functions.
- No type inference or static type checking.
- No object oriented programming concepts.
- No locks. (If you think you know of an ideal storage mechanism to use, please share!)


