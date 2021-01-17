# Documentation
Functionality may not be here but still exist. Check the [spec](https://github.com/Conder-Systems/tuna-lang/blob/main/tuna-compiler/src/test/language.spec.ts) for exhaustive documentation.

## Roles 
Roles are unique data structure that are signed by the system. Using roles allows you to restrict who can call functions and gurantees that whatever state exists on the role has not been mutated.

```
role some_user {
    name: string
}

some_user func foo() {
    'within this scope, the instance of some_user can be accessed by '
    'the keyword "caller":'
    caller.name
}
```
The `caller` object is immutable within the scope of the function.

To call the function foo above, you must provide a some_user role as the first argument. For further details, see the [demo](./demos/roles/).

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

When `some_func` is invoked by a client, we automatically validate the input match the type. 

### Union types
Unions can be formed by using the keyword `or`: `type foo= string or int`.

### Type Aliases

Type aliases can be defined like they are in typescript: `type my_type = string`.

## Locking

Any string can be "locked." This essentially creates a mutex with the string value. This is used for preventing data races. Locks are automatically released when 1) encountering errors 2) returning from a function in which a lock was acquired. To see locks in actons, see the [messaging app demo](./tuna/demos/simple-messenger/main.tuna)

## Architecture
Tuna is built on conder. Performance is/will be achieved by building on [conder](https://github.com/Conder-Systems/conder). Conder is a compiler for abstract representations of functions that run mutations/queries against global and local state. Assuming you're running locally, when you compile a tuna program, your functions are reduced to op code that can run on the conder interpreter. The op code is provided to the conder [stored procedure server](https://hub.docker.com/r/condersystems/sps/tags?page=1&ordering=last_updated) and the stored procedure server is run locally. Your functions will be reachable behind an http endpoint. See the demos and cli instructions for more details. 

### Invoking Tuna Code

Tuna code is interpreted behind an HTTP web server. You can invoke your functions on this webserver in three ways.
#### Verbose mode
Verbose mode is used in all of the [demo tests](demos/simple-twitter/test.py).
#### HTTP GET
Consider issuing a get to /func_name?arg=1&foo=12. This would invoke func_name with the first argument being an object containing the query parameters in an object and all values as strings. In other words the object would look like this:
```
{
    arg: "1",
    foo: "12"
}
```
If you intend to use gets, your function should only have one argument containing all the parameters.

#### HTTP POST
Posts work similarly to gets. However, no query params are supported. Instead, the JSON body is passed to the function named in the request path.

## Deploying

Example deployments are provided [here](./deploy_examples/). The examples use pulumi but you can use the tool of your choice.

The general instructions:
1. Run `tuna build` to get a main.can file.
2. Make whatever modifications you need to the deployment script such as region, sizes, etc.
   1. You must change the project to your project (i.e. don't use conder-systems gcp project).
3. Initialize environment with mongo & gcp credentials. Pulumi will instruct you with whats missing if you don't have it.
4. `pulumi up -y` to deploy. This will output a url for your cloud run service.


# Limitation Summary
All of the following limitations are temporary:
- No type inference or static type checking.
- No object oriented programming concepts.
- Only support http
- Pass-by-value, not reference.


