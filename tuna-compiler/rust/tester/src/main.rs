
use tuna_interpreter::{conduit_byte_code_interpreter, Globals};
use tuna_interpreter::ops::{Op};
use std::collections::HashMap;
use serde::{Deserialize};
use std::fs;

#[derive(Deserialize)]
struct Main {
    main: Vec<Op>,
}

#[tokio::main]
async fn main() -> Result<(), std::io::Error> {
    let main: Main = serde_json::from_str(
        std::str::from_utf8(
            fs::read(&"main.can")?.as_slice()
        ).unwrap())?;

    
    Ok(())
}
