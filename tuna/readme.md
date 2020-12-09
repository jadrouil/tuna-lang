# tuna CLI

A CLI for compiling and running the tuna programming language.

## Getting Started


### Install

```shell
$ npm i -g tuna-lang
$ tuna version
$ tuna init
```
Note: Docker is required to run your program locally.

### Commands

### run

In a directory with a main.tuna file:
```shell
$ tuna run
```
This will start your system exposed at http://localhost:7213 by default.

For examples on interacting with your system see the [demos](demos/)

### warn

This will calculate what locks your program needs to hold to avoid stale state race conditions. Tuna currently does not acquire locks on the users behalf because Mongo does not expose a locking API in their rust driver. Therefore, if your program requires any locks, it is unsafe but you may run it.

In the future, if Mongo supports locks, or conder supports a storage layer that does,
the hope is to enable automatic lock acquisition, or at least allow the user to manually acquire locks.

# License

MIT - see LICENSE

