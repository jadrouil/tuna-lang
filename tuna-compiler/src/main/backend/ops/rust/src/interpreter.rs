use std::collections::HashMap;
use futures::future::{BoxFuture, FutureExt};

use crate::data::{InterpreterType, Obj};
use crate::ops::{Op};
use crate::schemas::Schema;
use actix_web::{Responder, HttpResponse};


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
    pub db: Option<&'a mongodb::Database>, 
    pub stores: &'a HashMap<String, Schema>,
    pub fns: &'a HashMap<String, Vec<Op>>,
    pub private_key: &'a[u8; 64],
    pub public_key: &'a [u8; 32]
}


pub fn conduit_byte_code_interpreter_internal<'a>(
    mut current: Context<'a>,
    globals: &'a Globals<'a>
) ->BoxFuture<'a, Result<InterpreterType, String>> {
    
    if current.exec.ops.len() == 0 {
        return async {Ok(InterpreterType::None)}.boxed();
    }
    
    return async move {
        loop {
            let res: Result<ContextState, String> = current.execute_next_op(globals).await;

            let state = match res {
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

pub async fn conduit_byte_code_interpreter(
    state: Vec<InterpreterType>, 
    ops: &Vec<Op>,
    globals: Globals<'_>) -> impl Responder {
    let context = Context::new(ops, state);
    let output = conduit_byte_code_interpreter_internal(context, &globals).await;
    return match output {
        Ok(data) => HttpResponse::Ok().json(data),
        Err(s) => {
            eprintln!("{}", s);
            HttpResponse::BadRequest().finish()
        }
    }
}