
#![allow(non_snake_case)]
#![allow(non_camel_case_types)]
#![allow(redundant_semicolons)]
#![allow(unused_variables)]
#![allow(dead_code)]
#![allow(unused_imports)]
use actix_web::{web, App, HttpResponse, HttpServer, Responder, http, guard};
use actix_rt::System;
use std::env;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::collections::HashSet;
use std::future::Future;
use awc;
use std::borrow::Borrow;
use bytes::Bytes;
use mongodb::{Database};
use std::convert::TryFrom;
use std::convert::TryInto;
use ts_rs::{export, TS};
use crypto::ed25519;
use std::hash::{Hash, Hasher};
use std::collections::hash_map::DefaultHasher;
use futures::future::{BoxFuture, FutureExt};
use crate::data::{InterpreterType, Obj};
use crate::schemas::{Schema};
use crate::ops::{Op};
use crate::interpreter::{Globals, conduit_byte_code_interpreter};
mod storage;
mod data;
mod schemas;
mod ops;
mod interpreter;

struct AppData {
    noop: Vec<Op>,
    procs: HashMap<String, Vec<Op>>,
    privateFns: HashSet<String>,
    schemas: HashMap<String, Schema>,
    stores: HashMap<String, Schema>,
    private_key: [u8; 64],
    public_key: [u8; 32],
    db: Option<mongodb::Database>
}

#[derive(Deserialize)]
#[serde(tag = "kind", content= "data")]
enum KernelRequest {
    Noop,
    Exec {proc: String, arg: Vec<InterpreterType>}
}    


#[actix_rt::main]
async fn main() -> std::io::Result<()> {
    let args: Vec<String> = env::args().collect();
    HttpServer::new(|| {
        App::new()
            .data_factory(|| make_app_data())
            .service(
                web::scope("/")
                    .service(                        
                        web::resource("{func_name}")
                        .guard(guard::Get())
                        .route(web::get().to(get_func))
                    )  
                    .service(
                        web::resource("{func_name}")
                        .guard(guard::Post())
                        .route(web::post().to(post_func))
                    )   
                    .service(
                        web::resource("").guard(guard::Put()).route(web::put().to(index))
                    )                                                 
            )
        
    })
    .bind(format!("0.0.0.0:{}", args[1]))?
    .run()
    .await
}

async fn process_req(req: KernelRequest, data: web::Data<AppData>) -> impl Responder {
    let g = Globals {
        schemas: &data.schemas,
        db: data.db.as_ref(),
        stores: &data.stores,
        fns: &data.procs,
        private_key: &data.private_key,
        public_key: &data.public_key
    };
    return match req {
        KernelRequest::Noop => conduit_byte_code_interpreter(vec![], &data.noop, g),
        KernelRequest::Exec{proc, arg} => match data.procs.get(&proc) {
            Some(ops) => {
                if data.privateFns.contains(&proc) {
                    eprintln!("Attempting to invoke a private function {}", &proc);
                    conduit_byte_code_interpreter(vec![], &data.noop, g)
                }else {
                    conduit_byte_code_interpreter(arg, ops, g)
                }
            },
            None => {
                eprintln!("Invoking non-existent function {}", &proc);
                conduit_byte_code_interpreter(vec![], &data.noop, g)
            }                
        }
    }.await;
    
}
async fn get_func(data: web::Data<AppData>, path: web::Path<String>, q: web::Query<HashMap<String, InterpreterType>>) -> impl Responder {
    let func_name = path.into_inner();
    let args = q.into_inner();
    return process_req(KernelRequest::Exec{proc: func_name, arg: vec![InterpreterType::Object(Obj(args))]}, data).await;
}

async fn post_func(data: web::Data<AppData>, input: web::Json<InterpreterType>, path: web::Path<String>) -> impl Responder {    
    let args = vec![input.into_inner()]; 
    let func_name = path.into_inner();        
    return process_req(KernelRequest::Exec{proc: func_name, arg: args}, data).await;
}

async fn index(data: web::Data<AppData>, input: web::Json<KernelRequest>) -> impl Responder {    
    let req = input.into_inner();            
    return process_req(req, data).await;
}

async fn make_app_data() -> Result<AppData, ()> {
return Ok(AppData {
    noop: serde_json::from_str(r#####"[]"#####).unwrap(),
    procs: match env::var("PROCEDURES") {
        Ok(str) => serde_json::from_str(&str).unwrap(),
        Err(e) => {
            eprintln!("Did not find any procedures {}", e);
            HashMap::with_capacity(0)
        }
    },
    privateFns: match env::var("PRIVATE_PROCEDURES") {
        Ok(str) => serde_json::from_str(&str).unwrap(),
        Err(e) => HashSet::with_capacity(0)
    },
    schemas: match env::var("SCHEMAS") {
        Ok(str) => serde_json::from_str(&str).unwrap(),
        Err(e) => {
            eprintln!("Did not find any schemas {}", e);
            HashMap::with_capacity(0)
        }
    },
    stores: match env::var("STORES") {
        Ok(r) => serde_json::from_str(&r).unwrap(),
        Err(e) => panic!("Did not receive a definition for any stores")
    },
    private_key: match env::var("PRIVATE_KEY") {
        Ok(some_str) => {
            if some_str.len() != 64 * 3  - 1{
                panic!("Unexpected string length");
            }
            let mut u8s: Vec<u8> = Vec::with_capacity(64);                    
            for chunk in some_str.split_whitespace() {
                u8s.push(u8::from_str_radix(chunk, 16).unwrap());
            }
            let conv: [u8; 64] = match u8s.try_into() {
                Ok(r) => r,
                Err(e) => panic!("Failure getting private key: {:?}", e)
            };
            conv
        },
        Err(e) => panic!("Private key could not be read")
    },
    public_key: match env::var("PUBLIC_KEY") {
        Ok(some_str) => {
            if some_str.len() != 32 * 3 - 1 {
                panic!("Unexpected string length");
            }
            let mut u8s: Vec<u8> = Vec::with_capacity(32);                    
            for chunk in some_str.split_whitespace() {
                u8s.push(u8::from_str_radix(chunk, 16).unwrap());
            }
            let conv: [u8; 32] = match u8s.try_into() {
                Ok(r) => r,
                Err(e) => panic!("Failure getting public key: {:?}", e)
            };
            conv
        },
        Err(e) => panic!("Public key could not be read")
    },
    db: match env::var("MONGO_CONNECTION_URI") {
        Ok(uri) => {
            let mut options = mongodb::options::ClientOptions::parse(&uri).await.unwrap();
            options.write_concern = Some(mongodb::options::WriteConcern::builder().w(mongodb::options::Acknowledgment::Majority).build());
            options.read_concern = Some(mongodb::options::ReadConcern::majority());
            let client = match mongodb::Client::with_options(options) {
                Ok(r) => r,
                Err(e) => panic!("Failure connecting to mongo: {}", e)
            };
            let deploymentname = env::var("DEPLOYMENT_NAME").unwrap();

            // List the names of the databases in that deployment.
            let cols = match client.database(&deploymentname).list_collection_names(None).await {
                Ok(r) => r,
                Err(e) => panic!("Failure connecting to mongo: {}", e)
            };
            for col in  cols{
                println!("{}", col);
            }
            Some(client.database(&deploymentname))
        },
        Err(e) => {
            None
        }
    }
    });
}
