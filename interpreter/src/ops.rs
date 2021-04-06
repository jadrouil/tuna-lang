
    
use std::collections::HashMap;
use std::convert::TryFrom;
use serde::{Deserialize};
use std::collections::hash_map::DefaultHasher;
use crypto::ed25519;
use std::hash::{Hash, Hasher};

use crate::data::*;

use crate::schemas::{Schema};
use crate::{Context, Globals, ContextState, conduit_byte_code_interpreter, State};

#[derive(Deserialize, Clone)]
#[serde(tag = "kind", content= "data")]
pub enum Op {
    negatePrev,
    stackTopMatches{schema: String},
    isLastNone,
    tryGetField(String),
    overwriteArg(u64),
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
    truncateHeap(usize),
    offsetOpCursor{offset: u64, fwd: bool},
    conditonallySkipXops(u64),
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


impl <'a> Context<'a>  {
    pub fn execute_next_op(&mut self, globals: &'a Globals<'a>, state: *mut State<'a>) -> Result<ContextState, String> {
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
            Op::overwriteArg(op_param) => {     
                unsafe {state.as_mut().unwrap().overwrite_var(*op_param as usize, self.pop_stack()?);}
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
                unsafe {state.as_mut().unwrap().set_field(*index as usize, fields, set_to);}
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
                unsafe {
                    self.stack.push(state.as_mut().unwrap().get_var(*param1 as usize, fields)?);
                }
                self.advance()
            },
            Op::deleteSavedField{field_depth, index} => {       
                let fields = self.stack.split_off(self.stack.len() - *field_depth as usize);
                unsafe {
                    state.as_mut().unwrap().delete(*index as usize, fields);
                }
                self.advance()
            },
            Op::pushSavedField{field_depth, index} => {                
                let push = self.pop_stack()?;
                let fields = self.stack.split_off(self.stack.len() - *field_depth as usize);
                unsafe {    
                    state.as_mut().unwrap().pushToArray(*index as usize, push, fields);                
                }
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
                unsafe {
                    state.as_mut().unwrap().drop(*op_param);
                }
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
            Op::returnStackTop => Ok(ContextState::Done(self.pop_stack()?)),
            Op::returnVoid => Ok(ContextState::Done(InterpreterType::None)),
            Op::copyFromHeap(op_param) => {
                unsafe {
                    self.stack.push(state.as_mut().unwrap().get_var(*op_param as usize, vec![])?);
                }
                self.advance()
            },
            Op::fieldAccess(op_param) => {
                let obj = self.pop_stack()?.to_obj()?;
                let res = obj.get(op_param).safe_unwrap()?;
                self.stack.push(res.clone());
                self.advance()
            },
            Op::enforceSchemaOnHeap{schema, heap_pos} => {                
                let v = unsafe {
                    state.as_mut().unwrap().get_var(*heap_pos as usize, vec![])?
                };
                let s = globals.schemas.get(schema).safe_unwrap()?;
                self.stack.push(InterpreterType::bool(s.adheres(&v, globals.schemas, globals.public_key)));
                self.advance()
            },
            Op::moveStackTopToHeap => {                
                let data = self.pop_stack()?;
                unsafe {
                    state.as_mut().unwrap().save(data);
                }
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
                unsafe {
                    state.as_mut().unwrap().pushToArray(*op_param as usize, p, vec![]);
                }
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
            Op::enforceSchemaInstanceOnHeap{heap_pos, schema} => {                
                let v =
                unsafe {
                    state.as_mut().unwrap().get_var(*heap_pos as usize, vec![])?
                };
                self.stack.push(InterpreterType::bool(schema.adheres(&v, globals.schemas, globals.public_key)));
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
                let size= unsafe { state.as_ref().unwrap().sizeOfScope()
                };
                if  size != *op_param as usize{
                    Err(format!("unexpected heap len {}, found {}", *op_param, size))
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
                let cntxt = Context::new(next_ops);
                unsafe {
                    state.as_mut().unwrap().push(args);
                }
        
                let res = conduit_byte_code_interpreter(
                    cntxt,
                    globals,
                    state
                )?;
                unsafe {
                    state.as_mut().unwrap().pop();
                }
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