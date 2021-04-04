use tuna_interpreter::schemas::{Schema};
use std::collections::{HashMap};

pub enum Entity {
    Func,
    GlobalState,
    Type(Schema),
    Const,
    Var
}

pub struct ScopeMap {
    lookup: HashMap<String, Entity>,
    stack: Vec<Vec<String>>
}

impl ScopeMap {
    pub fn new() -> ScopeMap {
        ScopeMap {
            lookup: HashMap::new(),
            stack: vec![]
        }
    }

    pub fn add(&mut self, name: String, e: Entity) -> Result<(), String> {
        match self.lookup.insert(name.clone(), e) {
            Some(_other) => return Err(format!("{} collides with something in scope.", name)),
            _ => {}
        };
        self.stack.last_mut().unwrap().push(name);
        Ok(())
    }

    pub fn pop(&mut self) {
        let remove = self.stack.pop().unwrap();
        for thing in remove {
            self.lookup.remove(&thing);
        }
    }

    pub fn push(&mut self) {
        self.stack.push(vec![]);
    }
}

pub struct ScopeSizer {
    lookup: HashMap<String, usize>,
    stack: Vec<Vec<String>>
}


impl ScopeSizer {
    pub fn new() -> ScopeSizer {
        ScopeSizer {
            lookup: HashMap::new(),
            stack: vec![vec![]]
        }
    }

    pub fn add(&mut self, name: String) -> usize {
        let val = self.lookup.len();
        self.lookup.insert(name.clone(), val);
        self.stack.last_mut().unwrap().push(name);
        val
    }
    pub fn get(& self, name: &String) -> u64 {
        *self.lookup.get(name).unwrap() as u64
    }

    pub fn pop(&mut self) -> u64 {
        let remove = self.stack.pop().unwrap();
        for thing in &remove {
            self.lookup.remove(thing);
        }
        remove.len() as u64
    }

    pub fn push(&mut self) {
        self.stack.push(vec![]);
    }
}