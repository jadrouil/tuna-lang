use std::collections::HashMap;
use std::fmt::Debug;
use serde::{Deserialize, Serialize, Serializer, Deserializer};
use std::hash::{Hash, Hasher};

#[derive(Debug, Clone, PartialEq)]
pub struct Obj(pub HashMap<String, InterpreterType>);

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

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
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

impl InterpreterType {
    pub fn to_str(self) -> Result<String, String> {
        match self {
            InterpreterType::string(s) => Ok(s),
            InterpreterType::int(i) => Ok(i.to_string()),
            InterpreterType::double(d) => Ok(d.to_string()),
            _ => Err("Cannot convert to string".to_string())
        }
    }
    pub fn to_obj(self) -> Result<HashMap<String, InterpreterType>, String> {
        match self {
            InterpreterType::Object(o) => Ok(o.0),
            _ => Err("Expected an object".to_string())
        }
    }

    pub fn to_bool(self) -> Result<bool, String> {
        match self {
            InterpreterType::bool(b) => Ok(b),
            _ => Err("Expected a boolean value".to_string())
        }
    }

    pub fn to_array(self) -> Result<Vec<InterpreterType>, String> {
        match self {
            InterpreterType::Array(r) => Ok(r),
            _ => Err("Expected an array".to_string())
        }
    }

    pub fn try_push(&mut self, data: InterpreterType) -> Result<(), String> {
        match self {
            InterpreterType::Array(r) => {r.push(data); Ok(())},
            _ => Err("Expected an array".to_string())
        }
    }
    
    pub fn get<'a>(&'a mut self, field: InterpreterType) -> Result<Option<&'a mut InterpreterType>, String> {
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


    pub fn set<'a>(&mut self, mut fields: Vec<InterpreterType>, set_to: InterpreterType) -> Result<(), String> {
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

    pub fn equals(&self, other: &InterpreterType) -> bool {
        match (self, other) {
            (InterpreterType::string(s1), InterpreterType::string(s2)) => s1 == s2,
            (InterpreterType::int(i1), InterpreterType::int(i2)) => i1 == i2,
            (InterpreterType::double(d1), InterpreterType::double(d2)) => d1 == d2,
            (InterpreterType::None, InterpreterType::None) => true,
            (_, _) => false
        }
    }

    pub fn compare(&self, other: &InterpreterType) -> Result<Compare, String> {
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

    pub fn plus(&self, other: &InterpreterType) -> Result<InterpreterType, String> {
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

    pub fn minus(&self, other: &InterpreterType) -> Result<InterpreterType, String> {
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

    pub fn divide(&self, other: &InterpreterType) -> Result<InterpreterType, String> {
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

    pub fn multiply(&self, other: &InterpreterType) -> Result<InterpreterType, String> {
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


pub enum Compare {
    Less,
    Greater,
    Equal
}


pub trait Safe<T> {
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