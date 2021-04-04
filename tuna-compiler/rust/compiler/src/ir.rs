
#![allow(unused_imports)]

use tuna_interpreter::data::{InterpreterType};
use tuna_interpreter::schemas::{Schema};

pub struct Conditional {
    pub condition: Value, 
    pub body: Vec<Root>
}

pub enum Mut {
    Overwrite(Value),
    Push(Vec<Value>),
    Delete
}

pub struct Call {
    pub function: String, 
    pub args: Vec<Value>
}

pub enum Root {
    Branch(Vec<Conditional>),
    Save {val: Value, name: String},
    Update {root: Saved, level: Vec<Value>, operation: Mut},
    ForEach {target: Value, body: Vec<Root>, arg: String},
    Call(Call),
    Return(Option<Value>)
}

pub struct Field {
    pub key: String, 
    pub value: Value
}
pub struct Saved(pub String);
type Value = Box<AnyValue>;
pub enum AnyValue {
    Bool(bool),
    Object(Vec<Field>),
    Int(i64),
    Double(f64),
    String(String),
    None,
    GetType(Value),
    Not(Value),
    BinaryOp {sign: Sign, left: Value, right: Value},
    Is {val: Value, typ: String},
    RoleInstance {schema: Schema, data: Vec<Field>},
    Saved(String),
    Selection {root: Value, level: Vec<Value>},
    Keys(Value),
    Array(Vec<Value>),
    Call(Call)
}

pub enum Sign {
    Eq,
    Neq,
    L,
    G,
    Leq,
    Geq,
    Plus,
    Minus,
    And,
    Or,
    Div,
    Mult
}


pub struct Function<'a> {
    pub name: &'a str,
    pub args: Vec<(Schema, String)>,
    pub body: Vec<Root>
}