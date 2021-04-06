#![allow(dead_code)]
#[macro_use]
extern crate pest_derive;
extern crate pest;

use ir::*;
use pest::{Parser, error::Error};
use pest::iterators::{Pairs, Pair};
use std::{collections::HashMap, convert::TryInto};
use tuna_interpreter::schemas::Schema;
use tuna_interpreter::ops::Op;
use std::str::FromStr;

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

type Token<'a> = Pair<'a, Rule>;

impl<'a> Tuna<Vec<(Schema, String)>> for Token<'a> {
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

impl<'a> Tuna<Vec<Box<AnyValue>>> for Token<'a> {
    fn tunify(self) -> Vec<Box<AnyValue>> {
        match self.as_rule() {
            Rule::args => {

            },
            _ => unreachable!()
        };

        vec![]
    }
}

impl<'a> Tuna<Call> for Token<'a> {
    fn tunify(self) -> Call {
        match self.as_rule() {
            Rule::functionCall => {
                let mut name = None;
                let mut args = vec![];
                for p in self.into_inner() {
                    match p.as_rule() {
                        Rule::name => name = Some(p.as_str()),
                        Rule::args => args = p.tunify(),
                        _ => unreachable!()
                    };
                }
                Call {
                    function: name.unwrap().to_string(),
                    args
                }
            },
            _ => unreachable!()
        }
    }
}

impl<'a> Tuna<Box<AnyValue>> for Token<'a> {
    fn tunify(self) -> Box<AnyValue> {
        let val = match self.as_rule() {
            Rule::expression => {
                let mut body = None;
                // let _prefix = None;
                // let _methods = vec![];
                for p in self.into_inner() {                                        
                    match p.as_rule() {
                        Rule::prefix|
                        Rule::method|
                        Rule::infix => {unreachable!()},
                        Rule::literal => {
                            let lit = p.into_inner().peek().unwrap();
                            body = Some(match lit.as_rule() {
                                Rule::object => {
                                    let mut fields = vec![];
                                    let mut name = None;
                                    for field in lit.into_inner() {
                                        match field.as_rule() {
                                            Rule::name => name = Some(field.as_str().to_string()),
                                            Rule::expression => {
                                                fields.push(Field {
                                                    key: name.unwrap(),
                                                    value: field.tunify()
                                                });
                                                name = None;
                                            },
                                            _ => unreachable!()
                                        };
                                    }
                                    AnyValue::Object(fields)
                                },
                                Rule::string => AnyValue::String(lit.as_str().to_string()),
                                Rule::boolean => AnyValue::Bool(lit.as_str() == "true"),
                                Rule::num => AnyValue::Double(f64::from_str(lit.as_str()).unwrap()),
                                Rule::none => AnyValue::None,
                                Rule::array => {
                                    let mut values = vec![];
                                    for v in lit.into_inner() {
                                        values.push(v.tunify());
                                    }
                                    AnyValue::Array(values)
                                },
                                _ => unreachable!()
                            });
                        },
                        
                        Rule::functionCall => body = Some(AnyValue::Call(p.tunify())),
                        Rule::name => body = Some(AnyValue::Saved(p.as_str().to_string())),
                        _ => unreachable!()
                    };
                }
                body.unwrap()
            },
            _ => unreachable!()
        };
        Box::new(val)
    }
}

impl<'a> Tuna<ValueOrRoot> for Token<'a> {
    fn tunify(self) -> ValueOrRoot {
        match self.as_rule() {
            Rule::ret => {
                let mut exp = None;
                for i in self.into_inner() {
                    match i.as_rule() {
                        Rule::expression => exp = Some(i.tunify()),
                        _ => unreachable!()
                    };
                }
                Either::Left(Root::Return(exp))
            },
            Rule::var => {
                let mut exp = None;
                let mut name = None;
                for i in self.into_inner() {
                    match i.as_rule() {
                        Rule::name => name = Some(i.as_str()),
                        Rule::expression => exp = Some(i.tunify()),
                        _ => unreachable!()
                    };
                }
                Either::Left(
                    Root::Save{val: exp.unwrap(), name: name.unwrap().to_string()}
                )
            },
            // Rule::forLoop => {

            // },
            // Rule::ifs => {

            // },
            // Rule::assignment => roots.push(part.tunify()),
            Rule::expression => Either::Right(self.tunify()),
            _ => unreachable!()
        }
    }
}

impl<'a> Tuna<Vec<ValueOrRoot>> for Token<'a> {
    fn tunify(self) -> Vec<ValueOrRoot> {
        let mut roots = vec![];
        match self.as_rule() {
            Rule::scope => {
                for part in self.into_inner() {
                    match part.as_rule() {
                        Rule::ret |
                        Rule::var |
                        Rule::forLoop |
                        Rule::ifs |
                        Rule::assignment => roots.push(part.tunify()),
                        Rule::expression => roots.push(part.tunify()),
                        _ => unreachable!()
                    }
                }
            },
            _ => unreachable!()
        }
        
        roots
    }
}

impl<'a> Tuna<ir::Function<'a>> for Pair<'a, Rule> {
    fn tunify(self) -> ir::Function<'a> {
        match self.as_rule() {
            Rule::func => {
                let pairs = self.into_inner();
                let mut name = None;
                let mut args = vec![];
                let mut body = vec![];
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
                            body.append(&mut pair.tunify());
                        },
                        _ => panic!("Unexpected rule {}", pair)
                    }
                }                
                Function {
                    name: name.unwrap(),
                    args,
                    body
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