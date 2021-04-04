#![allow(non_camel_case_types)]
#![allow(non_snake_case)]

use std::collections::HashMap;
use futures::future::{BoxFuture, FutureExt};

use crate::data::{InterpreterType};
use crate::ops::{Op};
use crate::schemas::Schema;

pub mod data;
pub mod schemas;
pub mod ops;

pub struct Execution<'a> {
    pub next_op_index: usize,
    pub ops: &'a Vec<Op>,
}

pub struct Context<'a> {
    pub heap: Vec<InterpreterType>,
    pub stack: Vec<InterpreterType>,
    pub exec: Execution<'a>,
}


pub enum ContextState {
    Continue,
    Done(InterpreterType)
}

impl <'a> Context<'a>  {

    fn has_remaining_exec(&self) -> bool {
        self.exec.next_op_index < self.exec.ops.len()
    }

    pub fn advance(&mut self) -> Result<ContextState, String> {
        self.exec.next_op_index += 1;
        if !self.has_remaining_exec() {
            return Ok(ContextState::Done(InterpreterType::None))
        }
        return Ok(ContextState::Continue);
    }

    pub fn offset_cursor(&mut self, forward: bool, offset: usize) {
        if forward {
            self.exec.next_op_index += offset;
        } else {
            self.exec.next_op_index -= offset;
        }
    }    

    pub fn new(ops: &'a Vec<Op>, heap: Vec<InterpreterType>) -> Context<'a> {
        Context {
            stack: vec![],
            exec: Execution {
                ops: ops,
                next_op_index: 0
            },
            heap: heap,
        }
    }
}

pub struct Globals<'a> {
    pub schemas: &'a HashMap<String, Schema>, 
    pub stores: &'a HashMap<String, Schema>,
    pub fns: &'a HashMap<String, Vec<Op>>,
    pub private_key: &'a[u8; 64],
    pub public_key: &'a [u8; 32]
}


impl<'a>  Globals<'a> {
    pub fn new(
        schemas: &'a HashMap<String, Schema>, 
        stores: &'a HashMap<String, Schema>,
        fns: &'a HashMap<String, Vec<Op>>,
        private_key: &'a[u8; 64],
        public_key: &'a[u8; 32]) -> Self {
            Globals {
                schemas,
                stores,
                fns,
                private_key,
                public_key
            }
    }

    pub fn execute(&'a self, fname: &String, inputs: Vec<InterpreterType>) -> BoxFuture<'a, Result<InterpreterType, String>> {
        let context = Context::new(self.fns.get(fname).unwrap(), inputs);
        conduit_byte_code_interpreter(context, self)
    }
}

fn conduit_byte_code_interpreter<'a>(
    mut current: Context<'a>,
    globals: &'a Globals<'a>
) ->BoxFuture<'a, Result<InterpreterType, String>> {
    
    if current.exec.ops.len() == 0 {
        return async {Ok(InterpreterType::None)}.boxed();
    }
    
    return async move {
        loop {
            let res: Result<ContextState, String> = current.execute_next_op(globals).await;

            match res {
                Ok(body) => match body {
                    ContextState::Done(data) => {
                        return Ok(data);
                    },
                    _ => {} // The ops are responsible for getting the next instruction.
                },            
                Err(msg) => {
                    // We know there are no error handlers at the moment.
                    return Err(msg);
                },
            };
        }
    }.boxed();
}
