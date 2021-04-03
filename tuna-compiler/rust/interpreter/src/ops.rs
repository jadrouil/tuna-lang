
    
use std::collections::HashMap;
use std::convert::TryFrom;
use serde::{Deserialize};
use std::collections::hash_map::DefaultHasher;
use crypto::ed25519;
use std::hash::{Hash, Hasher};

use ts_rs::{TS, export};
use crate::data::{InterpreterType, Obj};
use crate::schemas::{Schema};
use crate::{Context, Globals, ContextState, conduit_byte_code_interpreter_internal};

#[derive(Deserialize, Clone, TS)]
#[serde(tag = "kind", content= "data")]
pub enum Op {
    negatePrev,
    stackTopMatches{schema: String},
    isLastNone,
    tryGetField(String),
    overwriteHeap(u64),
    raiseError(String),
    noop,
    setField{field_depth: u64},
    setSavedField{field_depth: u64, index: u64},
    stringConcat{nStrings: u64, joiner: String},
    getField{field_depth: u64},
    getSavedField(u64, u64),
    deleteSavedField{field_depth: u64, index: u64},
    pushSavedField{field_depth: u64, index: u64},
    fieldExists,
    truncateHeap(u64),
    offsetOpCursor{offset: u64, fwd: bool},
    conditonallySkipXops(u64),
    returnVariable(u64),
    returnStackTop,
    returnVoid,
    copyFromHeap(u64),
    fieldAccess(String),
    enforceSchemaOnHeap{schema: String, heap_pos: u64},
    moveStackTopToHeap,
    popStack,
    instantiate(InterpreterType),
    popArray,
    flattenArray,
    toBool,
    moveStackToHeapArray(u64),
    arrayPush,
    pArrayPush{stack_offset: u64},
    assignPreviousToField(String),
    arrayLen,
    ndArrayLen,
    setNestedField(Vec<String>),
    copyFieldFromHeap(u64, Vec<String>),
    enforceSchemaInstanceOnHeap{schema: Schema, heap_pos: u64},
    extractFields(Vec<Vec<String>>),
    equal,
    less,
    lesseq,
    boolAnd,
    boolOr,
    assertHeapLen(u64),
    repackageCollection,
    plus,
    nMinus,
    nDivide,
    nMult,
    getKeys,
    invoke{name: String, args: u64},
    signRole,
    getType
}    
      

impl<'a> Context<'a> {

    pub fn pop_stack(&mut self) -> Result<InterpreterType, String> {
        match self.stack.pop() {
            Some(v) => Ok(v),
            _ => Err("Attempting to access non existent value".to_string())
        }
    }

    pub fn last_stack(&mut self) -> Result<&mut InterpreterType, String> {
        match self.stack.last_mut() {
            Some(m) => Ok(m),
            None => Err("Attempting to access non existent value".to_string())
        }
    }
}

trait Safe<T> {
    fn safe_ref_unwrap(&self) -> Result<&T, String>;
    fn safe_unwrap(self) -> Result<T, String>;
    fn safe_mut_ref_unwrap(&mut self) -> Result<&mut T, String>;
}

impl<T> Safe<T> for Option<T> {
    fn safe_ref_unwrap(&self) -> Result<&T, String> {
        match self {
            Some(v) => Ok(v),
            None => Err("Value does not exist".to_string())
        }
    }
    fn safe_mut_ref_unwrap(&mut self) -> Result<&mut T, String> {
        match self {
            Some(v) => Ok(v),
            None => Err("Value does not exist".to_string())
        }
    }
    fn safe_unwrap(self) -> Result<T, String> {
        match self {
            Some(v) => Ok(v),
            None => Err("Value does not exist".to_string())
        }
    }
}

impl InterpreterType {
    fn to_str(self) -> Result<String, String> {
        match self {
            InterpreterType::string(s) => Ok(s),
            InterpreterType::int(i) => Ok(i.to_string()),
            InterpreterType::double(d) => Ok(d.to_string()),
            _ => Err("Cannot convert to string".to_string())
        }
    }
    fn to_obj(self) -> Result<HashMap<String, InterpreterType>, String> {
        match self {
            InterpreterType::Object(o) => Ok(o.0),
            _ => Err("Expected an object".to_string())
        }
    }

    fn to_bool(self) -> Result<bool, String> {
        match self {
            InterpreterType::bool(b) => Ok(b),
            _ => Err("Expected a boolean value".to_string())
        }
    }

    fn to_array(self) -> Result<Vec<InterpreterType>, String> {
        match self {
            InterpreterType::Array(r) => Ok(r),
            _ => Err("Expected an array".to_string())
        }
    }

    fn try_push(&mut self, data: InterpreterType) -> Result<(), String> {
        match self {
            InterpreterType::Array(r) => {r.push(data); Ok(())},
            _ => Err("Expected an array".to_string())
        }
    }
    
    fn get<'a>(&'a mut self, field: InterpreterType) -> Result<Option<&'a mut InterpreterType>, String> {
        Ok(match self {
            InterpreterType::Object(o) => match field {
                InterpreterType::string(s) => o.0.get_mut(&s),
                _ => return Err(format!("Cannot index into object with this type"))
            },
            InterpreterType::Array(a) => match field {
                InterpreterType::int(i) =>a.get_mut(i as usize),
                InterpreterType::double(d) => a.get_mut(d as usize),
                _ => return Err(format!("Cannot index array with type"))
            },
            _ => return Err(format!("cannot index into type"))
        })
    }


    fn set<'a>(&mut self, mut fields: Vec<InterpreterType>, set_to: InterpreterType) -> Result<(), String> {
        let last_field = fields.pop().safe_unwrap()?;

        let mut o_or_a = self;
        for f in fields {
            o_or_a = o_or_a.get(f)?.safe_unwrap()?;
        }

        match o_or_a {
            InterpreterType::Object(o) => match last_field {
                InterpreterType::string(s) => o.0.insert(s, set_to),
                _ => return Err(format!("Cannot index object with this type"))
            },
            _ => return Err(format!("cannot overwrite type"))
        };
        Ok(())
    }

    fn equals(&self, other: &InterpreterType) -> bool {
        match (self, other) {
            (InterpreterType::string(s1), InterpreterType::string(s2)) => s1 == s2,
            (InterpreterType::int(i1), InterpreterType::int(i2)) => i1 == i2,
            (InterpreterType::double(d1), InterpreterType::double(d2)) => d1 == d2,
            (InterpreterType::None, InterpreterType::None) => true,
            (_, _) => false
        }
    }

    fn compare(&self, other: &InterpreterType) -> Result<Compare, String> {
        let d1 = match self {
            InterpreterType::int(i1) => *i1 as f64,
            InterpreterType::double(d1) => *d1,
            _ => return Err("Can only compare numbers".to_string())
        };
        let d2 = match other {
            InterpreterType::int(i1) => *i1 as f64,
            InterpreterType::double(d2) => *d2,
            _ => return Err("Can only compare numbers".to_string())
        };
        Ok(match (d1, d2) {
            (_, _) if d1 < d2 => Compare::Less,
            (_, _) if d1 > d2 => Compare::Greater,
            (_, _) => Compare::Equal
        })        
    }

    fn plus(&self, other: &InterpreterType) -> Result<InterpreterType, String> {
        Ok(match self {
            InterpreterType::int(i1) => match other {
                InterpreterType::int(i2) => InterpreterType::int(i1 + i2),
                InterpreterType::double(d2) => InterpreterType::double(*i1 as f64 + d2),
                InterpreterType::string(s) => InterpreterType::string(format!("{}{}", i1, s)),
                _ => return Err(format!("not addable"))
            },
            InterpreterType::double(d1) => match other {
                InterpreterType::int(i2) => InterpreterType::double(d1 + (*i2 as f64)),
                InterpreterType::double(d2) => InterpreterType::double(d1 + d2),
                InterpreterType::string(s) => InterpreterType::string(format!("{}{}", d1, s)),
                _ => return Err(format!("not addable"))
            }, 
            InterpreterType::string(s) => match other {
                InterpreterType::int(d) => InterpreterType::string(format!("{}{}", s, d)),
                InterpreterType::double(d) => InterpreterType::string(format!("{}{}", s, d)),
                InterpreterType::string(d) => InterpreterType::string(format!("{}{}", s, d)),
                _ =>return Err(format!("not addable"))
            }
            _ => return Err(format!("not addable"))
        })
    }

    fn minus(&self, other: &InterpreterType) -> Result<InterpreterType, String> {
        Ok(match self {
            InterpreterType::int(i1) => match other {
                InterpreterType::int(i2) => InterpreterType::int(i1 - i2),
                InterpreterType::double(d2) => InterpreterType::double(*i1 as f64 - d2),
                _ => return Err(format!("not subtractable"))
            },
            InterpreterType::double(d1) => match other {
                InterpreterType::int(i2) => InterpreterType::double(d1 - (*i2 as f64)),
                InterpreterType::double(d2) => InterpreterType::double(d1 - d2),
                _ => return Err(format!("not subtractable"))
            }, 
            _ => return Err(format!("not subtractable"))
        })
    }

    fn divide(&self, other: &InterpreterType) -> Result<InterpreterType, String> {
        Ok(match self {
            InterpreterType::int(i1) => match other {
                InterpreterType::int(i2) => InterpreterType::int(i1 / i2),
                InterpreterType::double(d2) => InterpreterType::double(*i1 as f64 / d2),
                _ => return Err(format!("not divisible"))
            },
            InterpreterType::double(d1) => match other {
                InterpreterType::int(i2) => InterpreterType::double(d1 / (*i2 as f64)),
                InterpreterType::double(d2) => InterpreterType::double(d1 / d2),
                _ => return Err(format!("not divisible"))
            }, 
            _ => return Err(format!("not divisible"))
        })
    }

    fn multiply(&self, other: &InterpreterType) -> Result<InterpreterType, String> {
        Ok(match self {
            InterpreterType::int(i1) => match other {
                InterpreterType::int(i2) => InterpreterType::int(i1 * i2),
                InterpreterType::double(d2) => InterpreterType::double(*i1 as f64 * d2),
                _ => return Err(format!("cannot multiply"))
            },
            InterpreterType::double(d1) => match other {
                InterpreterType::int(i2) => InterpreterType::double(d1 * (*i2 as f64)),
                InterpreterType::double(d2) => InterpreterType::double(d1 * d2),
                _ => return Err(format!("cannot multiply"))
            }, 
            _ => return Err(format!("cannot multiply"))
        })
    }
}

enum Compare {
    Less,
    Greater,
    Equal
}

impl <'a> Context<'a>  {
    pub async fn execute_next_op(&mut self, globals: &'a Globals<'a>) -> Result<ContextState, String> {
        match &self.exec.ops[self.exec.next_op_index] {
            Op::negatePrev => match self.pop_stack()? {
                InterpreterType::bool(b) =>  {self.stack.push(InterpreterType::bool(!b)); self.advance()},
                _ => return Err(format!("Negating a non boolean value"))
            },
            Op::stackTopMatches{schema} => {                
                let b = match globals.schemas.get(schema) {
                    Some(schema) => schema.adheres(
                        &self.pop_stack()?,
                        globals.schemas,
                        globals.public_key),
                    None => return Err(format!("Schema does not exist"))
                };
                self.stack.push(InterpreterType::bool(b));
                self.advance()
            },
            Op::isLastNone => {
                
                let res = match self.stack.last().safe_ref_unwrap()? {
                    InterpreterType::None => true,
                    _ => false
                };
                self.stack.push(InterpreterType::bool(res));
                self.advance()
            },
            Op::tryGetField(op_param) => {
                            
                match self.pop_stack()? {
                    InterpreterType::Object(mut o) => match o.0.remove(op_param) {
                        Some(f) => {
                            self.stack.push(f);
                            self.advance()
                        },
                        None => {
                            self.stack.push(InterpreterType::None);
                            self.advance()
                        }
                    },
                    _ =>return Err(format!("Not an object"))
                }
            },
            Op::overwriteHeap(op_param) => {     
                let index = *op_param as usize;
                if self.heap.len() <=  index{
                    return Err(format!("overwriting non existent heap variable"));
                } 
                self.heap[index] = self.pop_stack()?;                
                self.advance()        
            },
            Op::raiseError(op_param) => Err(op_param.to_string()),
            Op::noop => self.advance(),
            Op::setField{field_depth} => {
                
                let set_to = self.pop_stack()?;
                let fields = self.stack.split_off(self.stack.len() - (*field_depth as usize));
                self.last_stack()?.set(fields, set_to)?;
                self.advance()
            },
            Op::setSavedField{index, field_depth} => {                
                let set_to = self.pop_stack()?;
                let fields = self.stack.split_off(self.stack.len() - *field_depth as usize);
                let target = self.heap.get_mut(*index as usize).safe_unwrap()?;
                target.set(fields, set_to)?;
                self.advance()
            },
            Op::stringConcat{nStrings, joiner} => {
                
                let mut strings = Vec::with_capacity(*nStrings as usize);
                for _ in 1..=*nStrings {
                    let str = self.pop_stack()?.to_str()?;
                    strings.push(str);
                }
                strings.reverse();
                self.stack.push(InterpreterType::string(strings.join(joiner)));
                self.advance()        
            },
            Op::getField{field_depth} => {        
                let fields = self.stack.split_off(self.stack.len() - *field_depth as usize);
                let mut orig = self.pop_stack()?;
                let mut target = Some(&mut orig);
                for f in fields {
                    target = target.safe_unwrap()?.get(f)?;
                }
                self.stack.push(match target {
                    Some(t) => t.clone(),
                    None => InterpreterType::None
                });
                self.advance()
            },
            Op::getSavedField(param0, param1) => {                                
                let fields = self.stack.split_off(self.stack.len() - *param0 as usize);
                
                let mut target = self.heap.get_mut(*param1 as usize).safe_unwrap()?;
                for f in fields {
                    target = target.get(f)?.safe_unwrap()?;
                }

                self.stack.push(target.clone());                
                self.advance()
            },
            Op::deleteSavedField{field_depth, index} => {        
                let mut fields = self.stack.split_off(self.stack.len() - *field_depth as usize);
                let last_field = fields.pop().safe_unwrap()?;

                let mut o_or_a = self.heap.get_mut(*index as usize).safe_unwrap()?;
                for f in fields {
                    o_or_a =  o_or_a.get(f)?.safe_unwrap()?;
                }
                match o_or_a {
                    InterpreterType::Object(o) => match last_field {
                        InterpreterType::string(s) => o.0.remove(&s),
                        _ => return Err(format!("Cannot index object with this type"))
                    },
                    _ => return Err(format!("cannot delete type"))   
                };
                self.advance()
            },
            Op::pushSavedField{field_depth, index} => {
                
                let mut push = self.pop_stack()?.to_array()?;
                let fields = self.stack.split_off(self.stack.len() - *field_depth as usize);

                let mut o_or_a = self.heap.get_mut(*index as usize).safe_unwrap()?;
                for f in fields {
                    o_or_a = o_or_a.get(f)?.safe_unwrap()?;
                }
                let ar = match o_or_a {
                    InterpreterType::Array(a) => a,
                    _ => return Err("Can only push to arrays".to_string())
                };
                ar.append(&mut push);
                self.advance()
        
            },
            Op::fieldExists => {
                    
                let field = self.pop_stack()?.to_str()?;
                let obj = self.pop_stack()?.to_obj()?;
                self.stack.push(InterpreterType::bool(match obj.get(&field) {
                    Some(d) => match d {
                        InterpreterType::None => false,
                        _ => true
                    },
                    None => false
                }));
                self.advance()
        
            },
            Op::truncateHeap(op_param) => {
                
                if *op_param as usize > self.heap.len() {
                    return Err("removing more variables than in existince".to_string())
                } 
                self.heap.truncate(self.heap.len() - *op_param as usize);  
                self.advance()
        
            },
            Op::offsetOpCursor{offset, fwd} => {
                
                if *fwd {
                    self.offset_cursor(true, *offset as usize);
                } else {
                    self.offset_cursor(false, *offset as usize + 1);
                }
                self.advance()
            },
            Op::conditonallySkipXops(op_param) => {                
                if self.pop_stack()?.to_bool()? {
                    self.offset_cursor(true, *op_param as usize);
                }
                self.advance()
            },
            Op::returnVariable(op_param) => {
                
                let value = self.heap.swap_remove(*op_param as usize);
                Ok(ContextState::Done(value))
            },
            Op::returnStackTop => Ok(ContextState::Done(self.pop_stack()?)),
            Op::returnVoid => Ok(ContextState::Done(InterpreterType::None)),
            Op::copyFromHeap(op_param) => {
                self.stack.push(self.heap.get(*op_param as usize).safe_unwrap()?.clone());
                self.advance()
            },
            Op::fieldAccess(op_param) => {
                let obj = self.pop_stack()?.to_obj()?;
                let res = obj.get(op_param).safe_unwrap()?;
                self.stack.push(res.clone());
                self.advance()
            },
            Op::enforceSchemaOnHeap{schema, heap_pos} => {                
                let v = self.heap.get(*heap_pos as usize).safe_unwrap()?;
                let s = globals.schemas.get(schema).safe_unwrap()?;
                self.stack.push(InterpreterType::bool(s.adheres(v, globals.schemas, globals.public_key)));
                self.advance()
            },
            Op::moveStackTopToHeap => {                
                let data = self.pop_stack()?;
                self.heap.push(data);
                self.advance()        
            },
            Op::popStack => {
                self.pop_stack()?;
                self.advance()
            },
            Op::instantiate(op_param) => {                
                self.stack.push(op_param.clone());
                self.advance()        
            },
            Op::popArray => {                
                let mut arr = self.pop_stack()?.to_array()?;
                let res = match arr.pop() {
                    Some(v) => v,
                    None => InterpreterType::None
                };     
                self.stack.push(InterpreterType::Array(arr));
                self.stack.push(res);
                self.advance()        
            },
            Op::flattenArray => {                
                let mut res = self.pop_stack()?.to_array()?;
                res.reverse();
                self.stack.append(&mut res);
                self.advance()
            },
            Op::toBool => {                
                let val = match self.stack.last().safe_unwrap()? {
                    InterpreterType::bool(b) => InterpreterType::bool(b.clone()),
                    InterpreterType::None => InterpreterType::bool(false),
                    _ => InterpreterType::bool(true)
                };
                self.stack.push(val);
                self.advance()        
            },
            Op::moveStackToHeapArray(op_param) => {                
                let p = self.pop_stack()?;                
                self.heap.get_mut(*op_param as usize).safe_unwrap()?.try_push(p)?;
                self.advance()
            },
            Op::arrayPush => {
                let pushme = self.pop_stack()?;
                self.stack.last_mut().safe_unwrap()?.try_push(pushme)?;
                self.advance()
            },
            Op::pArrayPush{stack_offset} => {                
                let pushme = self.pop_stack()?;
                let pos = self.stack.len() - 1 - *stack_offset as usize;
                self.stack.get_mut(pos).safe_unwrap()?.try_push(pushme)?;
                self.advance()        
            },
            Op::assignPreviousToField(op_param) => {                
                let value = self.pop_stack()?;
                self.stack.last_mut().safe_unwrap()?.set(vec![InterpreterType::string(op_param.clone())], value)?;
                self.advance()
            },
            Op::arrayLen => {
                let arr = self.pop_stack()?.to_array()?;
                let v = match i64::try_from(arr.len()) {
                    Ok(v) => v,
                    Err(e) => return Err(format!("Could not convert to int: {}", e))
                };
                self.stack.push(InterpreterType::int(v)); 
                self.advance()
            },
            Op::ndArrayLen => {                
                let arr = match self.pop_stack()? {
                    InterpreterType::Array(a) => a,
                    _ => return Err("Expected an array".to_string())
                };
                let v = match i64::try_from(arr.len()) {
                    Ok(v) => InterpreterType::int(v),
                    Err(e) => return Err(format!("Could not convert to int: {}", e))
                };            
                self.stack.push(InterpreterType::Array(arr));
                self.stack.push(v);
                self.advance()                
            },
            Op::setNestedField(op_param) => {                
                let data = self.pop_stack()?;
                let mut target = self.stack.last_mut().safe_unwrap()?;
                let (last_field, earlier_fields) = op_param.split_last().safe_unwrap()?;        
                for f in earlier_fields {
                    target = target.get(InterpreterType::string(f.to_string()))?.safe_unwrap()?;
                }
                target.set(vec![InterpreterType::string(last_field.to_string())], data)?;
                self.advance()                        
            },
            Op::copyFieldFromHeap(param0, param1) => {                
                let mut target = self.heap.get_mut(*param0 as usize).safe_unwrap()?;
                for f in param1 {
                    target = target.get(InterpreterType::string(f.to_string()))?.safe_unwrap()?;
                }
                self.stack.push(target.clone());
                self.advance()
            },
            Op::enforceSchemaInstanceOnHeap{heap_pos, schema} => {                
                let v = self.heap.get(*heap_pos as usize).safe_unwrap()?;
                self.stack.push(InterpreterType::bool(schema.adheres(v, globals.schemas, globals.public_key)));
                self.advance()        
            },
            Op::extractFields(op_param) => {                
                let mut original_object = self.pop_stack()?.to_obj()?;
                for selector in op_param {
                    let (first, rest) = selector.split_first().safe_unwrap()?;
                    let mut obj = original_object.get_mut(first).safe_unwrap()?;
                
                    for field in rest {
                        obj = obj.get(InterpreterType::string(field.to_string()))?.safe_unwrap()?;
                    }
                    self.stack.push(obj.clone());
                };            
                self.advance()
            },
            Op::equal => {                
                let first = self.pop_stack()?;
                let second = self.pop_stack()?;

                self.stack.push(InterpreterType::bool(first.equals(&second)));
                self.advance()        
            },
            Op::less => {                
                let right = self.pop_stack()?;
                let left = self.pop_stack()?;    
                self.stack.push(InterpreterType::bool(match left.compare(&right)? {
                    Compare::Less => true,
                    _ => false
                }));            
                self.advance()        
            },
            Op::lesseq => {                
                let right = self.pop_stack()?;
                let left = self.pop_stack()?;
                self.stack.push(InterpreterType::bool(
                    match left.compare(&right)? {
                        Compare::Greater => false,
                        _ => true
                    }
                ));            
                self.advance()
            },
            Op::boolAnd => {
                let first = self.pop_stack()?.to_bool()?;
                let second = self.pop_stack()?.to_bool()?;        
                self.stack.push(InterpreterType::bool(first && second));
                self.advance()
            },
            Op::boolOr => {                
                let first = self.pop_stack()?.to_bool()?;
                let second = self.pop_stack()?.to_bool()?;        
                self.stack.push(InterpreterType::bool(first || second));
                self.advance()
            },
            Op::assertHeapLen(op_param) => {
                
                if self.heap.len() != *op_param as usize{
                    Err(format!("unexpected heap len {}, found {}", *op_param, self.heap.len()))
                } else {
                    self.advance()
                }        
            },
            Op::repackageCollection => {
                
                let mut array = match self.pop_stack()? {
                    InterpreterType::Array(a) => a,
                    _ => return Err("need an array to repackage".to_string())
                };
                let mut re = HashMap::with_capacity(array.len());
                while let Some(elt) = array.pop() {
                    match elt {
                        InterpreterType::Object(mut o) => {
                            let k = o.0.remove("_key").safe_unwrap()?.to_str()?;                    
                            let v = o.0.remove("_val").safe_unwrap()?;
                            re.insert(k, v);
                        },
                        _ => return Err("Expected an object in the val field".to_string())
                    };
                }
                self.stack.push(InterpreterType::Object(Obj(re)));
                self.advance()        
            },
            Op::plus => {                
                let right = self.pop_stack()?;
                let left = self.pop_stack()?;
                let result = left.plus(&right)?;
                self.stack.push(result);
                self.advance()        
            },
            Op::nMinus => {
                let right = self.pop_stack()?;
                let left = self.pop_stack()?;
                let result = left.minus(&right)?;
                self.stack.push(result);
                self.advance()
            },
            Op::nDivide => {
                let right = self.pop_stack()?;
                let left = self.pop_stack()?;
                let result = left.divide(&right)?;
                self.stack.push(result);
                self.advance()
            },
            Op::nMult => {
                let right = self.pop_stack()?;
                let left = self.pop_stack()?;
                let result = left.multiply(&right)?;
                self.stack.push(result);
                self.advance()
            },
            Op::getKeys => {                
                let mut obj = self.pop_stack()?.to_obj()?;
                let keys = obj.drain().map(|(k, _v)| InterpreterType::string(k)).collect();
                self.stack.push(InterpreterType::Array(keys));
                self.advance()        
            },
            Op::invoke{name, args} => {                
                let args = self.stack.split_off(self.stack.len() - *args as usize);
                let next_ops = globals.fns.get(name).safe_unwrap()?;
                let cntxt = Context::new(next_ops, args);
                let res = conduit_byte_code_interpreter_internal(
                    cntxt,
                    globals
                ).await?;
                self.stack.push(res);
                self.advance()        
            },
            Op::signRole => {                
                let mut obj = match self.pop_stack()? {
                    InterpreterType::Object(o) => o.0,
                    _ => return Err("Require an object for signing".to_string())
                };
                let name_value = obj.remove("_name").safe_unwrap()?.to_str()?;
                
                let mut hasher = DefaultHasher::new();
                hasher.write(name_value.as_bytes());
                match obj.get("_state") {
                    Some(state) => state.hash(&mut hasher),
                    _ => {}
                };
                let msg: [u8; 8] = hasher.finish().to_be_bytes();
                let sig: [u8; 64] = ed25519::signature(&msg, globals.private_key);
                if !ed25519::verify(&msg, globals.public_key, &sig) {
                    return Err(format!("Public key cannot validate signature."));
                }
                let all: Vec<InterpreterType> = sig.iter().map(|i| InterpreterType::int(*i as i64)).collect();
                obj.insert("_sig".to_string(), InterpreterType::Array(all));
                obj.insert("_name".to_string(), InterpreterType::string(name_value));
                self.stack.push(InterpreterType::Object(Obj(obj)));
                self.advance()
            },        
            Op::getType => {                
                let val = self.pop_stack()?;
                let s = match val {
                    InterpreterType::None => "none",
                    InterpreterType::int(_) => "int",
                    InterpreterType::bool(_) => "bool",
                    InterpreterType::double(_) => "doub",
                    InterpreterType::Array(_) => "arr",
                    InterpreterType::string(_) => "str",
                    InterpreterType::Object(_) => "obj"
                };
                self.stack.push(InterpreterType::string(s.to_string()));
                self.advance()
        
            }
        }
    }
}

export! {
    Op => "ops.ts"
}