use ts_rs::{TS, export};
use std::collections::HashMap;
use std::fmt::Debug;
use serde::{Deserialize, Serialize, Serializer, Deserializer};
use std::any::TypeId;
use std::convert::TryInto;
use std::hash::{Hash, Hasher};
use std::collections::hash_map::DefaultHasher;
use crypto::ed25519;

use crate::data::{InterpreterType, Obj};

#[derive(Clone)]
pub struct ObjSchema(HashMap<String, Schema>);

impl TS for  ObjSchema {
    fn name() -> String {
        return "Record<string, Schema>".to_string();
    }

    fn dependencies() -> Vec<(TypeId, String)>{
        return vec![]
    }

    fn transparent() -> bool {
        return false
    }

    fn inline(indent: usize) -> String {
        return "Record<string, Schema>".to_string();
    }
}

impl<'de> Deserialize<'de> for ObjSchema {
    fn deserialize<D>(deserializer: D) ->  Result<Self, D::Error> where D: Deserializer<'de>{
        let data = HashMap::deserialize(deserializer)?;
        return Ok(ObjSchema(data));
    }
}

#[derive(Deserialize, Clone, TS)]
#[serde(tag = "kind", content= "data")]
pub enum Schema {
    Object(ObjSchema),
    Role(String, Vec<Schema>),
    Array(Vec<Schema>),
    Union(Vec<Schema>),
    Map(Vec<Schema>),
    TypeAlias(String),
    double,
    int,
    string,
    bool,
    Any,
    none
}




impl Schema {
    pub fn is_none(&self) -> bool {
        match self {
            Schema::none => true,
            _ => false
        }
    }

    pub fn is_optional(&self) -> bool {
        match self {
            Schema::Union(inner) => inner.into_iter().any(|o| o.is_none()),
            _ => false
        }
    }

    pub fn adheres(&self, value: &InterpreterType, schemas: &HashMap<String, Schema>, public_key: &[u8]) -> bool {
        match self {
            Schema::Union(options) => options.into_iter().any(|o| o.adheres(value, schemas, public_key)),
            Schema::TypeAlias(name) => match schemas.get(name) {
                Some(t) => t.adheres(value, schemas, public_key),
                None => false
            },
            Schema::Map(entry_t) => match value {
                InterpreterType::Object(internal_value) => internal_value.0.values().all(|v| entry_t[0].adheres(v, schemas, public_key)),
                _ => false
            },
            Schema::Object(internal_schema) => match value {
                InterpreterType::Object(internal_value) => {
                    let mut optionals_missing = 0;
                    let mut adheres = true;
                    for (k, v_schema) in &internal_schema.0 {
                        adheres = match internal_value.0.get(k) {
                            Some(v_value) => v_schema.adheres(v_value, schemas, public_key),
                            None => {
                                if v_schema.is_optional() {
                                    optionals_missing += 1;
                                    true 
                                } else {
                                    false
                                }
                            }
                        };
                        if !adheres {
                            break
                        }
                    }
                    adheres && internal_schema.0.len() - optionals_missing >= internal_value.0.len()
                },
                _ => false
            },
            Schema::Array(internal) => match value {
                InterpreterType::Array(internal_value) => internal_value.iter().all(|val| internal[0].adheres(&val, schemas, public_key)),
                _ => false
            },
            Schema::none => match value {
                InterpreterType::None => true,
                _ => false
            },
            
            Schema::Role(role_name, state_schema) => {
                let obj = match value {
                    InterpreterType::Object(o) => o,
                    _ => return false
                };
                let name = match obj.0.get("_name") {
                    Some(name_val) => match name_val {
                        InterpreterType::string(s) => s,
                        _ => return false
                    },
                    None => return false
                };
                let given_signature = match obj.0.get("_sig") {
                    Some(sig) => match sig {
                        InterpreterType::Array(a) => {
                            let mut results = Vec::with_capacity(a.len());
                            for i in a {
                                let u: u8 = match i {
                                    InterpreterType::int(_i) => match (*_i).try_into() {
                                        Ok(v) => v,
                                        Err(_) => {
                                            eprintln!("Failed to convert back to u8");
                                            return false;
                                        }
                                    },
                                    _ => return false
                                };
                                results.push(u);
                            }
                            results
                        },
                        _ => return false
                    },
                    None => return false
                };
                if given_signature.len() != 64 {
                    return false
                }
                let mut hasher = DefaultHasher::new();
                hasher.write(name.as_bytes());
                let check_state = match obj.0.get("_state") {
                    Some(state) => {
                        state.hash(&mut hasher);
                        Some(state)
                    },
                    None => None
                };
                let msg: [u8; 8] = hasher.finish().to_be_bytes();
                ed25519::verify(&msg, public_key, given_signature.as_slice()) && match check_state {
                    Some(state) => state_schema[0].adheres(state, schemas, public_key),
                    None => state_schema[0].adheres(&InterpreterType::Object(Obj(HashMap::with_capacity(0))), schemas, public_key)
                }
            },
        Schema::Any => true,
        Schema::double => match value {
            InterpreterType::double(_) => true,
            InterpreterType::int(_) => true,
            _ => false
        },
        Schema::int => match value {
            InterpreterType::int(_) => true,
            _ => false    
        },
        Schema::string => match value {
            InterpreterType::string(_) => true,
            _ => false        
        },
        Schema::bool => match value {
            InterpreterType::bool(_) => true,
            _ => false
        }
        }
    }
}


export! {
    Schema => "schemas.ts"
}