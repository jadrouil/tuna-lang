use ts_rs::{TS, export};
use std::collections::HashMap;
use std::fmt::Debug;
use serde::{Deserialize, Serialize, Serializer, Deserializer};
use std::any::TypeId;
use std::hash::{Hash, Hasher};

#[derive(Debug, Clone)]
pub struct Obj(pub HashMap<String, InterpreterType>);

impl TS for  Obj {
    fn name() -> String {
        return "{ [K in string]: InterpreterType}".to_string();
    }

    fn dependencies() -> Vec<(TypeId, String)>{
        return vec![]
    }

    fn transparent() -> bool {
        return false
    }

    fn inline(indent: usize) -> String {
        return "{ [K in string]: InterpreterType}".to_string();
    }
}

impl Serialize for Obj {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.0.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for Obj {
    fn deserialize<D>(deserializer: D) ->  Result<Self, D::Error> where D: Deserializer<'de>{
        let data = HashMap::deserialize(deserializer)?;
        return Ok(Obj(data));
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, TS)]
#[serde(untagged)]
pub enum InterpreterType {
    int(i64),
    double(f64),
    bool(bool),
    string(String),
    Array(Vec<InterpreterType>),
    Object(Obj),
    None
} 

impl Hash for InterpreterType {
    fn hash<H: Hasher>(&self, state: &mut H) {
        match self {
            InterpreterType::double(d) => {
                state.write(b"d");
                state.write_u64(d.to_bits());
            },
            InterpreterType::Object(o) => {
                let mut sorted_keys: Vec<&String> = o.0.keys().collect();
                sorted_keys.sort();
                for k in sorted_keys {
                    state.write(k.as_bytes());
                    o.0.get(k).unwrap().hash(state);
                }
            },
            InterpreterType::int(i) => {
                state.write_i64(*i);
            },
            InterpreterType::bool(b) => {
                state.write_u8(*b as u8);
            }
            InterpreterType::string(s) => {
                state.write(s.as_bytes());
            },
            InterpreterType::Array(a) => {
                for entry in a {
                    entry.hash(state);
                }
            },
            InterpreterType::None => {
            }
        };

    }
} 

export! {
    InterpreterType => "data.ts",
}
