#![allow(dead_code)]
#[macro_use]
extern crate pest_derive;
extern crate pest;

use ir::Function;
use pest::{Parser, error::Error};
use pest::iterators::{Pairs, Pair};
use std::{collections::HashMap};
use tuna_interpreter::schemas::Schema;
use tuna_interpreter::ops::Op;

pub mod ir;
pub mod backend;
pub mod frontend;
mod scope;

#[derive(Parser)]
#[grammar = "tuna.pest"]
pub struct TunaParser;

pub struct Executable {
    pub schemas: HashMap<String, Schema>, 
    pub stores: HashMap<String, Schema>,
    pub fns: HashMap<String, Vec<Op>>,
}


trait Tuna<T> {
    fn tunify(self) -> T;
}


impl<'a> Tuna<Vec<(Schema, String)>> for Pair<'a, Rule> {
    fn tunify(self) -> Vec<(Schema, String)> {
        match self.as_rule() {
            Rule::params => {
                let mut v = vec![];
                for param in self.into_inner() {        
                    println!("PARAM {}", param.as_str());
                    match param.as_rule() {
                        Rule::name => v.push((Schema::Any, param.as_str().to_string())),
                        _ => panic!("Unexpected: {}", param)
                    };            
                }
                v
            },
            _ => unreachable!()
        }
    }
}

impl<'a> Tuna<ir::Function<'a>> for Pair<'a, Rule> {
    fn tunify(self) -> ir::Function<'a> {
        match self.as_rule() {
            Rule::func => {
                let pairs = self.into_inner();
                let mut name = None;
                let mut args = vec![];
                for pair in pairs {
                    match pair.as_rule() {
                        Rule::name => {
                            name = Some(pair.as_str());
                            println!("NAME {}", name.unwrap());
                        },
                        Rule::params => {
                            println!("PARAMS {}", pair.as_str());
                            args.append(&mut pair.tunify());
                        },
                        Rule::scope => {
                            println!("SCOPE {}", pair.as_str());
                        },
                        _ => panic!("Unexpected rule {}", pair)
                    }
                }                
                Function {
                    name: name.unwrap(),
                    args,
                    body: vec![]
                }
            },
            _ => panic!("Unexpected rule {}", self)
        }
    }
}

fn print_everything(p: Pair<Rule>) {
    println!("P {:?}", p);        
    println!("rule {:?}", p.as_rule());        
    println!("Span:    {:?}", p.as_span());
    println!("Text:    {}", p.as_str());
    for thing in p.into_inner() {
        println!("Thing {:?}", thing);        
        println!("rule {:?}", thing.as_rule());        
        println!("Span:    {:?}", thing.as_span());
        println!("Text:    {}", thing.as_str());
    }
}

pub fn compile(input: &str) -> Result<Executable, Error<Rule>> {
    let globals: Pairs<Rule> = TunaParser::parse(Rule::globals, input)?;
    let mut funcs = HashMap::new();
    let mut stores = HashMap::new();
    for global in globals {
        
        for thing in global.into_inner() {
            match thing.as_rule() {
                Rule::func => {
                    let f: ir::Function = thing.tunify();
                    funcs.insert(f.name.to_string(), f);
                },
                Rule::globject => {
                    let mut name = None;
                    for p in thing.into_inner() {                        
                        match p.as_rule() {
                            Rule::name => name = Some(p.as_str()),
                            _ => {}
                        };
                    }
                    stores.insert(name.unwrap().to_string(), Schema::Any);
                }
                _ => panic!("Unexpected rule {}", thing)
            };
        }        
    }

    let mut fns = HashMap::with_capacity(funcs.len());
    for (k, v) in funcs.drain() {
        fns.insert(k, backend::to_ops(v));
    }

    Ok(Executable {
        schemas: HashMap::new(),
        stores,
        fns
    })
}