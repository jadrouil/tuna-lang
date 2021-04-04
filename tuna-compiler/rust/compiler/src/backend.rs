use tuna_interpreter::ops::{Op};
use tuna_interpreter::data::{InterpreterType, Obj};
use tuna_interpreter::schemas::{Schema};
use std::collections::HashMap;
use crate::scope::{ScopeSizer};
use crate::ir::*;



pub fn to_ops(function: Function) -> Vec<Op> {
    let mut instrs = vec![];
    instrs.push(Op::assertHeapLen(function.args.len() as u64));
    let mut scope = ScopeSizer::new();
    let mut heap_pos = 0;
    for (schema, name) in function.args {
        
        scope.add(name.clone());
        instrs.append(&mut vec![
            Op::enforceSchemaInstanceOnHeap{schema, heap_pos},
            Op::conditonallySkipXops(1),
            Op::raiseError(format!("Input did not match expectations for {}", name))
        ]);
        heap_pos += 1;
    }
    for b in function.body {
        instrs.append(&mut b.to_ops(&mut scope));
    }
    instrs
}

trait Compilable {
    fn to_ops(&self, scope: &mut ScopeSizer) -> Vec<Op>;
}

type Data = InterpreterType;
impl Compilable for AnyValue {
    fn to_ops(&self, scope: &mut ScopeSizer) -> Vec<Op> {
        let mut instrs: Vec<Op> = vec![];

        match self {
            AnyValue::Bool(b) => instrs.push(Op::instantiate(Data::bool(*b))),
            AnyValue::Object(fields) => {
                instrs.push(Op::instantiate(Data::Object(Obj(HashMap::with_capacity(0)))));
                for field in fields {
                    instrs.push(Op::instantiate(Data::string(field.key.clone())));
                    instrs.append(&mut field.value.to_ops(scope));
                    instrs.push(Op::setField{field_depth: 1});
                }
            },
            AnyValue::Int(i) => instrs.push(Op::instantiate(Data::int(*i))),
            AnyValue::None => instrs.push(Op::instantiate(Data::None)),
            AnyValue::GetType(v) => {
                instrs.append(&mut v.to_ops(scope));
                instrs.push(Op::getType);
            },
            AnyValue::Not(v) => {
                instrs.append(&mut v.to_ops(scope));
                instrs.push(Op::negatePrev);
            },
            AnyValue::BinaryOp{sign, left, right} => {
                instrs.append(&mut left.to_ops(scope));
                instrs.append(&mut right.to_ops(scope));
                instrs.append(&mut match sign {
                    Sign::Eq => vec![Op::equal],
                    Sign::Neq => vec![Op::equal, Op::negatePrev],
                    Sign::L => vec![Op::less],
                    Sign::G => vec![Op::lesseq, Op::negatePrev],
                    Sign::Leq => vec![Op::lesseq],
                    Sign::Geq => vec![Op::less, Op::negatePrev],
                    Sign::Plus => vec![Op::plus],
                    Sign::Minus => vec![Op::nMinus],
                    Sign::And => vec![Op::boolAnd],
                    Sign::Or => vec![Op::boolOr],
                    Sign::Div => vec![Op::nDivide],
                    Sign::Mult => vec![Op::nMult]
                });
            },
            AnyValue::Is{val, typ} => {
                instrs.append(&mut val.to_ops(scope));
                instrs.push(Op::stackTopMatches{schema: typ.clone()});
            },
            AnyValue::RoleInstance{schema, data} => {
                let (name, _schem) = match schema {
                    Schema::Role(name, schem) => (name, schem),
                    _ => panic!("Unexpected schema")
                };
                let mut base_obj = HashMap::new();
                base_obj.insert("_name".to_string(), Data::string(name.to_string()));
                let object = Data::Object(Obj(base_obj));
                instrs.push(Op::instantiate(object));
                if data.len() > 0 {
                    instrs.push(Op::instantiate(Data::string("_state".to_string())));
                    instrs.push(Op::instantiate(Data::Object(Obj(HashMap::with_capacity(0)))));
                    for field in data {
                        instrs.push(Op::instantiate(Data::string(field.key.clone())));
                        instrs.append(&mut field.value.to_ops(scope));
                        instrs.push(Op::setField{field_depth: 1});
                    }
                    instrs.push(Op::setField{field_depth: 1});                    
                }
                instrs.push(Op::signRole); 
            },
            AnyValue::Saved(name) => instrs.push(Op::copyFromHeap(scope.get(name))),
            AnyValue::Selection{root, level} => {
                instrs.append(&mut root.to_ops(scope));
                if level.len() > 0 {
                    for lev in level {
                        instrs.append(&mut lev.to_ops(scope));
                    }
                    instrs.push(Op::getField{field_depth: level.len() as u64});
                }
            },
            AnyValue::Keys(v) => {
                instrs.append(&mut v.to_ops(scope));
                instrs.push(Op::getKeys);
            },
            AnyValue::Array(vals) => {
                instrs.push(Op::instantiate(Data::Array(vec![])));
                for v in vals {
                    instrs.append(&mut v.to_ops(scope));
                    instrs.push(Op::arrayPush);
                }
            },
            AnyValue::Call(call) => instrs.append(&mut call.to_ops(scope))
        };
        instrs
    }
}

impl Compilable for Root {
    fn to_ops(&self, scope: &mut ScopeSizer) -> Vec<Op> {
        let mut instrs = vec![];
        
        match self {
            Root::Save{val, name} => {
                scope.add(name.to_string());
                instrs.append(&mut val.to_ops(scope));
                instrs.push(Op::moveStackTopToHeap);
            },
            Root::Update{root, level, operation} => {
                let field_depth = level.len() as u64;
                let index = scope.get(&root.0);
                match operation {
                    Mut::Overwrite(val) => {
                        if field_depth == 0 {
                            instrs.append(&mut val.to_ops(scope));
                            instrs.push(Op::overwriteHeap(index));
                        } else {
                            for l in level {
                                instrs.append(&mut l.to_ops(scope));
                            }
                            instrs.append(&mut val.to_ops(scope));
                            instrs.push(Op::setSavedField{field_depth, index});
                        }
                    },
                    Mut::Push(vals) => {
                        if field_depth > 0 {
                            for l in level {
                                instrs.append(&mut l.to_ops(scope));
                            }
                            instrs.push(Op::instantiate(Data::Array(vec![])));
                            for v in vals {
                                instrs.append(&mut v.to_ops(scope));
                                instrs.push(Op::arrayPush);
                            }
                            instrs.push(Op::pushSavedField{field_depth, index});
                        } else {
                            for v in vals {
                                instrs.append(&mut v.to_ops(scope));
                                instrs.push(Op::moveStackToHeapArray(index));
                            }
                        }
                    },
                    Mut::Delete => {
                        for l in level {
                            instrs.append(&mut l.to_ops(scope));
                        }
                        instrs.push(Op::deleteSavedField{field_depth, index});
                    }
                }
            },
            Root::ForEach {target, body, arg} => {
                scope.push();
                scope.add(arg.to_string());
                let mut loopbody = vec![
                    Op::popArray,
                    Op::moveStackTopToHeap,
                ];
                for b in body {
                    loopbody.append(&mut b.to_ops(scope));
                }
                loopbody.push(Op::truncateHeap(scope.pop()));
                let loop_len = loopbody.len() as u64;
                loopbody.push(Op::offsetOpCursor{offset: loop_len + 4, fwd: false});
                
                instrs.append(&mut target.to_ops(scope));
                instrs.append(&mut vec![
                    Op::ndArrayLen,
                    Op::instantiate(Data::int(0)),
                    Op::equal,
                    Op::conditonallySkipXops(loop_len),
                ]);
                instrs.append(&mut loopbody);
                instrs.push(Op::popStack);
            },
            Root::Call(call) => instrs.append(&mut call.to_ops(scope)),
            Root::Return(maybe_v) => match maybe_v {
                Some(v) => {
                    instrs.append(&mut v.to_ops(scope));
                    instrs.push(Op::returnStackTop);
                },
                None => instrs.push(Op::returnVoid)
            },
            Root::Branch(conds) => {
                let mut branches = vec![];
                let mut total_size = 0;
                for c in conds {
                    let this_one = c.to_ops(scope);
                    total_size += this_one.len();
                    branches.push(this_one);
                }

                let mut ops_before = 0;
                branches.reverse();
                while let Some(mut branch) = branches.pop() {
                    // [(Ops before)(this branch)(x branch remaining, skip to end)(last branch) end of branch]
                    let ops_remaining = total_size - ops_before - branch.len() + branches.len() - 1;
                    ops_before += branch.len();
                    branch.push(Op::offsetOpCursor{offset: ops_remaining as u64, fwd: true});
                    instrs.append(&mut branch);
                }
                instrs.push(Op::noop);
            }
        };
        instrs
    }
}

impl Compilable for Call {
    fn to_ops(&self, scope: &mut ScopeSizer) -> Vec<Op> {
        let mut instrs = vec![];
        for arg in &self.args {
            instrs.append(&mut arg.to_ops(scope));
        }
        instrs.push(Op::invoke{name: self.function.clone(), args: self.args.len() as u64});
        instrs
    }
}

impl Compilable for Conditional {
    fn to_ops(&self, scope: &mut ScopeSizer) -> Vec<Op> {
        let mut instrs = vec![];
        let mut body = vec![];
        scope.push();
        for b in &self.body {
            body.append(&mut b.to_ops(scope));
        }
        let scope_size = scope.pop();
        if scope_size > 0 {
            body.push(Op::truncateHeap(scope_size));
        }
        instrs.append(&mut self.condition.to_ops(scope));
        instrs.append(&mut vec![
            Op::negatePrev,
            Op::conditonallySkipXops(body.len() as u64)
        ]);
        instrs.append(&mut body);
        instrs.push(Op::noop);
        instrs
    }
}