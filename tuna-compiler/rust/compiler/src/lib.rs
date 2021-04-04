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



impl<'a> Tuna<ir::Function<'a>> for Pair<'a, Rule> {
    fn tunify(self) -> ir::Function<'a> {
        match self.as_rule() {
            Rule::func => {
                let pairs = self.into_inner();
                let mut name = None;
                for pair in pairs {
                    match pair.as_rule() {
                        Rule::name => {
                            name = Some(pair.as_str());
                            println!("NAME {}", name.unwrap());
                        },
                        Rule::params => {
                            println!("PARAMS {}", pair.as_str());
                        },
                        Rule::scope => {
                            println!("SCOPE {}", pair.as_str());
                        },
                        _ => panic!("Unexpected rule {}", pair)
                    }
                }                
                Function {
                    name: name.unwrap(),
                    args: vec![],
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
    for global in globals {
        
        for thing in global.into_inner() {
            match thing.as_rule() {
                Rule::func => {
                    let f: ir::Function = thing.tunify();
                    funcs.insert(f.name.to_string(), f);
                },
                _ => panic!("Unexpected rule {}", thing)
            };
        }
        
        // // A pair is a combination of the rule which matched and a span of input
        // println!("Rule:    {:?}", pair.as_rule());
        // println!("Span:    {:?}", pair.as_span());
        // println!("Text:    {}", pair.as_str());

        // // A pair can be converted to an iterator of the tokens which make it up:
        // for inner_pair in pair.into_inner() {
        //     match inner_pair.as_rule() {
        //         Rule::alpha => println!("Letter:  {}", inner_pair.as_str()),
        //         Rule::digit => println!("Digit:   {}", inner_pair.as_str()),
        //         _ => unreachable!()
        //     };
        // }
    }

    let mut fns = HashMap::with_capacity(funcs.len());
    for (k, v) in funcs.drain() {
        fns.insert(k, backend::to_ops(v));
    }

    Ok(Executable {
        schemas: HashMap::new(),
        stores: HashMap::new(),
        fns
    })
}