#![allow(non_camel_case_types)]
#![allow(non_snake_case)]

use std::{collections::HashMap};
use data::Safe;
use ops::Runner;
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
    pub stack: Vec<InterpreterType>,
    pub exec: Execution<'a>,
    pub after: Option<&'a mut Context<'a>>
}


pub enum ContextState<'a> {
    Continue(Context<'a>),
    Done(InterpreterType)
}

impl <'a> Context<'a>  {

    fn has_remaining_exec(&self) -> bool {
        self.exec.next_op_index < self.exec.ops.len()
    }

    pub fn advance(mut self) -> Result<ContextState<'a>, String> {
        self.exec.next_op_index += 1;
        if !self.has_remaining_exec() {
            return Ok(ContextState::Done(InterpreterType::None))
        }
        return Ok(ContextState::Continue(self));
    }

    pub fn offset_cursor(&mut self, forward: bool, offset: usize) {
        if forward {
            self.exec.next_op_index += offset;
        } else {
            self.exec.next_op_index -= offset;
        }
    }    

    pub fn new(ops: &'a Vec<Op>) -> Context<'a> {
        Context {
            stack: vec![],
            exec: Execution {
                ops: ops,
                next_op_index: 0
            },
            after: None
        }
    }
}

pub struct Globals<'a> {
    pub schemas: &'a HashMap<String, Schema>, 
    pub fns: &'a HashMap<String, Vec<Op>>,
    pub private_key: &'a[u8; 64],
    pub public_key: &'a [u8; 32]
}

pub struct State<'a> {
    state: &'a mut Vec<InterpreterType>,
    lookups: Vec<Vec<usize>>
}


impl<'a> State<'a> {
    pub fn new(inital_state: &'a mut Vec<InterpreterType>) -> Self {
        let mut arg_lookup = Vec::with_capacity(inital_state.len());
        for i in 0..inital_state.len() {
            arg_lookup.push(i);
        }
        State {
            state: inital_state,
            lookups: vec![arg_lookup]
        }
    }
    fn abs_addr(&self, arg_id: usize) -> usize {
        self.lookups.last().unwrap()[arg_id]
    }

    pub fn get_var(&mut self, arg_id: usize, fields: Vec<InterpreterType>) -> Result<InterpreterType, String> {
        let abs = self.abs_addr(arg_id);
        let mut target = Some(&mut self.state[abs]);
        
        for f in fields {
            target = target.safe_unwrap()?.get(f)?;
        }

        Ok(match target {
            Some(data) => data.clone(),
            None => InterpreterType::None
        })
    }

    pub fn overwrite_var(&mut self, arg_id: usize, value: InterpreterType) {
        let abs = self.abs_addr(arg_id);
        self.state[abs] = value;
        
    }
    
    pub fn set_field(&mut self, arg_id: usize, fields: Vec<InterpreterType>, value: InterpreterType) {
        let abs = self.abs_addr(arg_id);
        self.state[abs].set(fields, value).unwrap();
    }

    pub fn delete(&mut self, arg_id: usize, mut fields: Vec<InterpreterType>) {        
        let last_field = fields.pop().unwrap();
        let id = self.abs_addr(arg_id);
        let mut o_or_a = self.state.get_mut(id).unwrap();
        for f in fields {
            o_or_a =  o_or_a.get(f).unwrap().unwrap();
        }
        match o_or_a {
            InterpreterType::Object(o) => match last_field {
                InterpreterType::string(s) => o.0.remove(&s),
                _ => panic!("Cannot index object with this type")
            },
            _ => panic!("cannot delete type")
        };
    }

    pub fn drop(&mut self, to_drop: usize) {
        let lookup = self.lookups.last_mut().unwrap();
        for _  in 0..to_drop {
            let _ = lookup.pop().unwrap();
        }
        self.state.truncate(self.state.len() - to_drop);
    }

    pub fn save(&mut self, data: InterpreterType) {
        self.lookups.last_mut().unwrap().push(self.state.len());
        self.state.push(data);
    }

    pub fn pushToArray(&mut self, arg_id: usize, data: InterpreterType, fields: Vec<InterpreterType>) {
        let id = self.abs_addr(arg_id);
        let mut o_or_a = self.state.get_mut(id).unwrap();
        for f in fields {
            o_or_a =  o_or_a.get(f).unwrap().unwrap();
        }
        o_or_a.try_push(data).unwrap();
    }

    pub fn sizeOfScope(&self) -> usize {
        self.lookups.last().unwrap().len()
    }

    pub fn push(&mut self, mut initial: Vec<InterpreterType>) {
        let mut arg_lookup = Vec::new();
        for i in 0..initial.len() {
            arg_lookup.push(self.state.len() + i);
        }
        self.lookups.push(arg_lookup);
        self.state.append(&mut initial);
    }

    pub fn pop(&mut self) {
        let len = self.lookups.pop().unwrap().len();
        for _ in 0..len {
            self.state.pop();
        }
    }
}



impl<'a>  Globals<'a> {
    pub fn new(
        schemas: &'a HashMap<String, Schema>, 
        fns: &'a HashMap<String, Vec<Op>>,
        private_key: &'a[u8; 64],
        public_key: &'a[u8; 32]) -> Self {
            Globals {
                schemas,
                fns,
                private_key,
                public_key
            }
    }
    pub fn run(&'a self, fname: &String, state: &'a mut State<'a>) -> Result<InterpreterType, String> {
    
        let context = Context::new(self.fns.get(fname).unwrap());
        Runner::new(self, state).run(context)
    }
}


