
    
use std::collections::HashMap;
use std::convert::TryFrom;
use serde::{Deserialize};
use std::collections::hash_map::DefaultHasher;
use crypto::ed25519;
use std::hash::{Hash, Hasher};

use crate::data::*;

use crate::schemas::{Schema};
use crate::{Context, Globals, ContextState, State};

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


pub struct Runner<'a> {
    globals: &'a Globals<'a>,
    state: &'a mut State<'a>,
}

impl<'a> Runner<'a> {

    pub fn new(
        globals: &'a Globals<'a>,
        state: &'a mut State<'a>) -> Self {
        Runner {
            globals,
            state
        }
    }

    pub fn execute_next_op(&mut self,mut context: Context<'a>) -> Result<ContextState<'a>, String> {
        match &context.exec.ops[context.exec.next_op_index] {
            Op::negatePrev => match context.pop_stack()? {
                InterpreterType::bool(b) =>  {context.stack.push(InterpreterType::bool(!b)); context.advance()},
                _ => return Err(format!("Negating a non boolean value"))
            },
            Op::stackTopMatches{schema} => {                
                let b = match self.globals.schemas.get(schema) {
                    Some(schema) => schema.adheres(
                        &context.pop_stack()?,
                        self.globals.schemas,
                        self.globals.public_key),
                    None => return Err(format!("Schema does not exist"))
                };
                context.stack.push(InterpreterType::bool(b));
                context.advance()
            },
            Op::isLastNone => {
                
                let res = match context.stack.last().safe_ref_unwrap()? {
                    InterpreterType::None => true,
                    _ => false
                };
                context.stack.push(InterpreterType::bool(res));
                context.advance()
            },
            Op::tryGetField(op_param) => {
                            
                match context.pop_stack()? {
                    InterpreterType::Object(mut o) => match o.0.remove(op_param) {
                        Some(f) => {
                            context.stack.push(f);
                            context.advance()
                        },
                        None => {
                            context.stack.push(InterpreterType::None);
                            context.advance()
                        }
                    },
                    _ =>return Err(format!("Not an object"))
                }
            },
            Op::overwriteArg(op_param) => {     
                self.state.overwrite_var(*op_param as usize, context.pop_stack()?);
                context.advance()        
            },
            Op::raiseError(op_param) => Err(op_param.to_string()),
            Op::noop => context.advance(),
            Op::setField{field_depth} => {
                
                let set_to = context.pop_stack()?;
                let fields = context.stack.split_off(context.stack.len() - (*field_depth as usize));
                context.last_stack()?.set(fields, set_to)?;
                context.advance()
            },
            Op::setSavedField{index, field_depth} => {                
                let set_to = context.pop_stack()?;
                let fields = context.stack.split_off(context.stack.len() - *field_depth as usize);
                self.state.set_field(*index as usize, fields, set_to);
                context.advance()
            },
            Op::stringConcat{nStrings, joiner} => {
                
                let mut strings = Vec::with_capacity(*nStrings as usize);
                for _ in 1..=*nStrings {
                    let str = context.pop_stack()?.to_str()?;
                    strings.push(str);
                }
                strings.reverse();
                context.stack.push(InterpreterType::string(strings.join(joiner)));
                context.advance()        
            },
            Op::getField{field_depth} => {        
                let fields = context.stack.split_off(context.stack.len() - *field_depth as usize);
                let mut orig = context.pop_stack()?;
                let mut target = Some(&mut orig);
                for f in fields {
                    target = target.safe_unwrap()?.get(f)?;
                }
                context.stack.push(match target {
                    Some(t) => t.clone(),
                    None => InterpreterType::None
                });
                context.advance()
            },
            Op::getSavedField(param0, param1) => {                                
                let fields = context.stack.split_off(context.stack.len() - *param0 as usize);                
                context.stack.push(self.state.get_var(*param1 as usize, fields)?);
                context.advance()
            },
            Op::deleteSavedField{field_depth, index} => {       
                let fields = context.stack.split_off(context.stack.len() - *field_depth as usize);                
                self.state.delete(*index as usize, fields);                
                context.advance()
            },
            Op::pushSavedField{field_depth, index} => {                
                let push = context.pop_stack()?;
                let fields = context.stack.split_off(context.stack.len() - *field_depth as usize);            
                self.state.pushToArray(*index as usize, push, fields);                
                context.advance()
        
            },
            Op::fieldExists => {
                    
                let field = context.pop_stack()?.to_str()?;
                let obj = context.pop_stack()?.to_obj()?;
                context.stack.push(InterpreterType::bool(match obj.get(&field) {
                    Some(d) => match d {
                        InterpreterType::None => false,
                        _ => true
                    },
                    None => false
                }));
                context.advance()
        
            },
            Op::truncateHeap(op_param) => {                
                self.state.drop(*op_param);                
                context.advance()
        
            },
            Op::offsetOpCursor{offset, fwd} => {
                
                if *fwd {
                    context.offset_cursor(true, *offset as usize);
                } else {
                    context.offset_cursor(false, *offset as usize + 1);
                }
                context.advance()
            },
            Op::conditonallySkipXops(op_param) => {                
                if context.pop_stack()?.to_bool()? {
                    context.offset_cursor(true, *op_param as usize);
                }
                context.advance()
            },
            Op::returnStackTop => Ok(ContextState::Done(context.pop_stack()?)),
            Op::returnVoid => Ok(ContextState::Done(InterpreterType::None)),
            Op::copyFromHeap(op_param) => {                
                context.stack.push(self.state.get_var(*op_param as usize, vec![])?);                
                context.advance()
            },
            Op::fieldAccess(op_param) => {
                let obj = context.pop_stack()?.to_obj()?;
                let res = obj.get(op_param).safe_unwrap()?;
                context.stack.push(res.clone());
                context.advance()
            },
            Op::enforceSchemaOnHeap{schema, heap_pos} => {                
                let v = 
                    self.state.get_var(*heap_pos as usize, vec![])?;
                
                let s = self.globals.schemas.get(schema).safe_unwrap()?;
                context.stack.push(InterpreterType::bool(s.adheres(&v, self.globals.schemas, self.globals.public_key)));
                context.advance()
            },
            Op::moveStackTopToHeap => {                
                let data = context.pop_stack()?;
                self.state.save(data);
                
                context.advance()        
            },
            Op::popStack => {
                context.pop_stack()?;
                context.advance()
            },
            Op::instantiate(op_param) => {                
                context.stack.push(op_param.clone());
                context.advance()        
            },
            Op::popArray => {                
                let mut arr = context.pop_stack()?.to_array()?;
                let res = match arr.pop() {
                    Some(v) => v,
                    None => InterpreterType::None
                };     
                context.stack.push(InterpreterType::Array(arr));
                context.stack.push(res);
                context.advance()        
            },
            Op::flattenArray => {                
                let mut res = context.pop_stack()?.to_array()?;
                res.reverse();
                context.stack.append(&mut res);
                context.advance()
            },
            Op::toBool => {                
                let val = match context.stack.last().safe_unwrap()? {
                    InterpreterType::bool(b) => InterpreterType::bool(b.clone()),
                    InterpreterType::None => InterpreterType::bool(false),
                    _ => InterpreterType::bool(true)
                };
                context.stack.push(val);
                context.advance()        
            },
            Op::moveStackToHeapArray(op_param) => {                
                let p = context.pop_stack()?;                                
                self.state.pushToArray(*op_param as usize, p, vec![]);                
                context.advance()
            },
            Op::arrayPush => {
                let pushme = context.pop_stack()?;
                context.stack.last_mut().safe_unwrap()?.try_push(pushme)?;
                context.advance()
            },
            Op::pArrayPush{stack_offset} => {                
                let pushme = context.pop_stack()?;
                let pos = context.stack.len() - 1 - *stack_offset as usize;
                context.stack.get_mut(pos).safe_unwrap()?.try_push(pushme)?;
                context.advance()        
            },
            Op::assignPreviousToField(op_param) => {                
                let value = context.pop_stack()?;
                context.stack.last_mut().safe_unwrap()?.set(vec![InterpreterType::string(op_param.clone())], value)?;
                context.advance()
            },
            Op::arrayLen => {
                let arr = context.pop_stack()?.to_array()?;
                let v = match i64::try_from(arr.len()) {
                    Ok(v) => v,
                    Err(e) => return Err(format!("Could not convert to int: {}", e))
                };
                context.stack.push(InterpreterType::int(v)); 
                context.advance()
            },
            Op::ndArrayLen => {                
                let arr = match context.pop_stack()? {
                    InterpreterType::Array(a) => a,
                    _ => return Err("Expected an array".to_string())
                };
                let v = match i64::try_from(arr.len()) {
                    Ok(v) => InterpreterType::int(v),
                    Err(e) => return Err(format!("Could not convert to int: {}", e))
                };            
                context.stack.push(InterpreterType::Array(arr));
                context.stack.push(v);
                context.advance()                
            },
            Op::setNestedField(op_param) => {                
                let data = context.pop_stack()?;
                let mut target = context.stack.last_mut().safe_unwrap()?;
                let (last_field, earlier_fields) = op_param.split_last().safe_unwrap()?;        
                for f in earlier_fields {
                    target = target.get(InterpreterType::string(f.to_string()))?.safe_unwrap()?;
                }
                target.set(vec![InterpreterType::string(last_field.to_string())], data)?;
                context.advance()                        
            },
            Op::enforceSchemaInstanceOnHeap{heap_pos, schema} => {                
                let v = self.state.get_var(*heap_pos as usize, vec![])?;
                
                context.stack.push(InterpreterType::bool(schema.adheres(&v, self.globals.schemas, self.globals.public_key)));
                context.advance()        
            },
            Op::extractFields(op_param) => {                
                let mut original_object = context.pop_stack()?.to_obj()?;
                for selector in op_param {
                    let (first, rest) = selector.split_first().safe_unwrap()?;
                    let mut obj = original_object.get_mut(first).safe_unwrap()?;
                
                    for field in rest {
                        obj = obj.get(InterpreterType::string(field.to_string()))?.safe_unwrap()?;
                    }
                    context.stack.push(obj.clone());
                };            
                context.advance()
            },
            Op::equal => {                
                let first = context.pop_stack()?;
                let second = context.pop_stack()?;

                context.stack.push(InterpreterType::bool(first.equals(&second)));
                context.advance()        
            },
            Op::less => {                
                let right = context.pop_stack()?;
                let left = context.pop_stack()?;    
                context.stack.push(InterpreterType::bool(match left.compare(&right)? {
                    Compare::Less => true,
                    _ => false
                }));            
                context.advance()        
            },
            Op::lesseq => {                
                let right = context.pop_stack()?;
                let left = context.pop_stack()?;
                context.stack.push(InterpreterType::bool(
                    match left.compare(&right)? {
                        Compare::Greater => false,
                        _ => true
                    }
                ));            
                context.advance()
            },
            Op::boolAnd => {
                let first = context.pop_stack()?.to_bool()?;
                let second = context.pop_stack()?.to_bool()?;        
                context.stack.push(InterpreterType::bool(first && second));
                context.advance()
            },
            Op::boolOr => {                
                let first = context.pop_stack()?.to_bool()?;
                let second = context.pop_stack()?.to_bool()?;        
                context.stack.push(InterpreterType::bool(first || second));
                context.advance()
            },
            Op::assertHeapLen(op_param) => {
                let size= self.state.sizeOfScope();
                
                if  size != *op_param as usize{
                    Err(format!("unexpected heap len {}, found {}", *op_param, size))
                } else {
                    context.advance()
                }        
            },
            Op::repackageCollection => {
                
                let mut array = match context.pop_stack()? {
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
                context.stack.push(InterpreterType::Object(Obj(re)));
                context.advance()        
            },
            Op::plus => {                
                let right = context.pop_stack()?;
                let left = context.pop_stack()?;
                let result = left.plus(&right)?;
                context.stack.push(result);
                context.advance()        
            },
            Op::nMinus => {
                let right = context.pop_stack()?;
                let left = context.pop_stack()?;
                let result = left.minus(&right)?;
                context.stack.push(result);
                context.advance()
            },
            Op::nDivide => {
                let right = context.pop_stack()?;
                let left = context.pop_stack()?;
                let result = left.divide(&right)?;
                context.stack.push(result);
                context.advance()
            },
            Op::nMult => {
                let right = context.pop_stack()?;
                let left = context.pop_stack()?;
                let result = left.multiply(&right)?;
                context.stack.push(result);
                context.advance()
            },
            Op::getKeys => {                
                let mut obj = context.pop_stack()?.to_obj()?;
                let keys = obj.drain().map(|(k, _v)| InterpreterType::string(k)).collect();
                context.stack.push(InterpreterType::Array(keys));
                context.advance()        
            },
            Op::invoke{name, args} => {                
                let args = context.stack.split_off(context.stack.len() - *args as usize);
                let next_ops = self.globals.fns.get(name).safe_unwrap()?;
                let cntxt = Context::new(next_ops);                
                self.state.push(args);
                
                let res = self.run(cntxt)?;
                                
                self.state.pop();
                context.stack.push(res);                
                context.advance()
                     
            },
            Op::signRole => {                
                let mut obj = match context.pop_stack()? {
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
                let sig: [u8; 64] = ed25519::signature(&msg, self.globals.private_key);
                if !ed25519::verify(&msg, self.globals.public_key, &sig) {
                    return Err(format!("Public key cannot validate signature."));
                }
                let all: Vec<InterpreterType> = sig.iter().map(|i| InterpreterType::int(*i as i64)).collect();
                obj.insert("_sig".to_string(), InterpreterType::Array(all));
                obj.insert("_name".to_string(), InterpreterType::string(name_value));
                context.stack.push(InterpreterType::Object(Obj(obj)));
                context.advance()
            },        
            Op::getType => {                
                let val = context.pop_stack()?;
                let s = match val {
                    InterpreterType::None => "none",
                    InterpreterType::int(_) => "int",
                    InterpreterType::bool(_) => "bool",
                    InterpreterType::double(_) => "doub",
                    InterpreterType::Array(_) => "arr",
                    InterpreterType::string(_) => "str",
                    InterpreterType::Object(_) => "obj"
                };
                context.stack.push(InterpreterType::string(s.to_string()));
                context.advance()
        
            }
        }
    }

    pub fn run(&mut self, mut context: Context<'a>) -> Result<InterpreterType, String> {
        if context.exec.ops.len() == 0 {
            return Ok(InterpreterType::None)
        }
        
        loop {
            let res: Result<ContextState, String> = self.execute_next_op(context);
    
            match res {
                Ok(body) => match body {
                    ContextState::Done(data) => {
                        return Ok(data);
                    },
                    ContextState::Continue(next)=> {
                        context = next;
                    } // The ops are responsible for getting the next instruction.
                },            
                Err(msg) => {
                    // We know there are no error handlers at the moment.
                    return Err(msg);
                },
            };
        }
    }
}