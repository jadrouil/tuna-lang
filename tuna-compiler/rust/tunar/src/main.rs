
use tuna_interpreter::{conduit_byte_code_interpreter, Globals, Context};
use tuna_interpreter::ops::{Op};
use tuna_interpreter::schemas::{Schema};
use std::collections::HashMap;
use serde::{Deserialize};
use std::fs;
use crypto::ed25519;
use rand;
use rand_core::RngCore;
use ts_rs::{TS, export};
use std::any::TypeId;

#[derive(Deserialize, TS)]
struct Runnable {
    main: Vec<Op>,
    lookups: Lookups
}

#[derive(Deserialize)]
struct Lookups {
    schemas: HashMap<String, Schema>, 
    functions: HashMap<String, Vec<Op>>
}

impl TS for Lookups {
    fn name() -> String {
        return r#"{
            schemas: Record<string, Schema>,
            functions: Record<string, Op[]>
        }
        "#.to_string();
    }

    fn dependencies() -> Vec<(TypeId, String)>{
        return vec![]
    }

    fn transparent() -> bool {
        return false
    }

    fn inline(_indent: usize) -> String {
        return r#"{
            schemas: Record<string, Schema>,
            functions: Record<string, Op[]>
        }
        "#.to_string();
    }

}

#[tokio::main]
async fn main() -> Result<(), std::io::Error> {
    let state: Runnable = serde_json::from_str(
        std::str::from_utf8(
            fs::read(&"main.can")?.as_slice()
        ).unwrap())?;

    let stores = HashMap::new();
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    let (priv_key, pub_key) = ed25519::keypair(&key);

    let res = conduit_byte_code_interpreter(
        Context::new(&state.main, vec![]),
        &Globals {
            schemas: &state.lookups.schemas,
            fns: &state.lookups.functions,
            stores: &stores,
            private_key: &priv_key,
            public_key: &pub_key
        }
    ).await;

    match res {
        Ok(_) => Ok(()),
        Err(e) => panic!("Failed running with: {}", e)
    }
}

export! {
    Runnable => "runnable.ts"
}