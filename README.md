# Tuna

The tuna programming language is used to build scalable web services quickly. Unlike other programming languages, global state is persisted in a database, rather than held in memory. As a result, any service written in tuna is scalable from day one. Tuna's syntax is intended to be as simple as possible:

```
const users = {}

pub func add_user(name) {
    users[name] = {}
}
```

These four lines mean: there is a users object which is persisted across requests, and a function called "add_user" that can be called by a client.


# Getting Started

## Installation
`$npm i tuna-lang`
`$tuna init`

## Examples
Examples can be found [demos](tuna/demos). This is a good place to get started to get a general sense of the syntax and how to interact with systems. You can run any of the demos using the command `$tuna run`.

## Documentation


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

## Architecture
Tuna is built on conder. Performance is/will be achieved by building on [conder](https://github.com/Conder-Systems/conder). Conder is a compiler for abstract representations of functions that run mutations/queries against global and local state. Assuming you're running locally, when you compile a tuna program, your functions are reduced to op code that can run on the conder interpreter. The op code is provided to the conder [stored procedure server](https://hub.docker.com/r/condersystems/sps/tags?page=1&ordering=last_updated) and the stored procedure server is run locally. Your functions will be reachable behind an http endpoint. See the demos and cli instructions for more details. 


# Limitation Summary
All of the following limitations are temporary:
- No type inference or static type checking.
- No object oriented programming concepts.


