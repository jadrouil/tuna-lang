Table of Contents
=================

   * [Table of Contents](#table-of-contents)
   * [Purpose](#purpose)
   * [Getting Started](#getting-started)
      * [Installation](#installation)
      * [Learning](#learning)
   * [Show Me the Rust Code](#show-me-the-rust-code)
   * [Contributing](#contributing)
   * [Disclaimer](#disclaimer)

# Purpose

The Tuna programming language is used to rapidly develop scalable web services. Consequently, there are a few notable differences between tuna and general purpose programming languages you may have used before: 
1. Tuna's global state is persisted in a database, rather than held in memory.
2. In Tuna, you describe which functions to expose over the network. 
3. Developers may define roles to limit access.

Altogether, you can build stateful web services with zero dependencies in as little as four lines of code:

```
const users = {}

pub func add_user(name) {
    users[name] = 'insert some initial data here'
}
```

These four lines mean: there is a users object which is persisted across requests, and a function called "add_user" that is exposed over an HTTP endpoint that can be called by anyone.

However, often in building web services, it is undesirable to allow anyone to do everything. Enter roles:

```
role admin {}

admin func do_something_dangerous() {
    ...
}

pub func get_admin_role(secret) {
    if secret == 'super secret key' {
        return admin {}
    }
    return 'no permission granted'
}
```

In order to call the `do_something_dangerous` function, a client must have an admin role granted. Roles can be stateful, and their state may be referenced in the receiving function. Check out the [demo on roles](./demos/roles).

[Learn more about the future of Tuna and the motivations here.](MOTIVATION.md)

# Getting Started

## Installation

1. You need to first install [docker](https://docs.docker.com/get-docker/) to run tuna locally.

2. `npm i -g tuna-lang`

3. Pull containers: `tuna init`. When you run tuna, we use the containers pulled here.

## Learning
- You can run any of the "main.tuna" files using the command `tuna run`. Example projects can be found in [demos](./demos).
- Questions can be asked in the [github discussions](https://github.com/Conder-Systems/tuna-lang/discussions).
- Complete documentation on the syntax, capabilities, and road map can be found [here](./DOCUMENTATION.md).

# Show Me the Rust Code
The interpreter and web server for Tuna code is all written in Rust. Only the Tuna
compiler is written in Typescript. The interpreter and webserver are in [Conder](https://github.com/Conder-Systems/conder).
Because the compiler and the interpreter are tightly coupled, a lot of the Rust code lives
in Typescript strings and isn’t accurately reflected in the language stats for the repo.
However, I intend to eventually refactor this code to move all Rust code out of Typescript
and then write a Rust macro for generating the Typescript API for interpreter instructions (Issue is [here](https://github.com/Conder-Systems/conder/issues/68)).

Rust code samples can be found in the following places:
- [Interpreter Structure and Schema Validation](https://github.com/Conder-Systems/conder/blob/master/conder_core/src/main/ops/interpreter/interpreter_writer.ts). 
- [Interpreter Instructions](https://github.com/Conder-Systems/conder/blob/master/conder_core/src/main/ops/interpreter/supported_op_definition.ts). Specifically, look at the "rustOpHandler" sections of the op definitions.
- Run `npm run gen` on the project to generate the rust code and examine it in the ops/rust/ folder. You'll likely want to fix whitespace before looking over this code.

# Contributing
 - Feature requests are welcomed and may be submitted as github issues.
 - If you want to contribute, feel free to pick up an issue, and submit a pull request with your completed work.

# Disclaimer
Tuna is an experimental language and is missing notable features for performance, security, verification, and developer productivity (e.g. OO concepts, IDE integrations).
