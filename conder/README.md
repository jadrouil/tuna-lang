
# Abstract

This is a set of compiler technologies that can be used to build programming languages where global state is stored in a database. The primary input to this compiler is the intermediate representation (IR).

# Conder Intermediate Representation

The [IR](conder_core/src/main/abstract/IR.ts) is a simple way to describe some computation that runs with some mixture of global and local state. It is essentially a programming language but rather than loosely structured text, it is written in javascript objects. The IR and its compilers provides the following benefits:
- Decoupling from storage providers
- Transparently optimize the structure to take advantage of opportunities like query planning, caching, etc.
- Type checking and inference

# Building Your Own Language 

If you want to build your own language on top of conder, feel free to reach out.

#### Languages built on Conder

-[Tuna-lang](https://github.com/Conder-Systems/tuna-lang)

### Licensing
All code is provided under the BSD 3-Clause license.