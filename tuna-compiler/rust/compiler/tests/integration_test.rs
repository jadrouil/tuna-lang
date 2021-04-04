use rand;
use rand_core::RngCore;
use crypto::ed25519;
use tuna_compiler;
use tuna_interpreter;
use tuna_interpreter::data::*;
type Data =InterpreterType;

async fn exec_test(code: &str, func: &str, args: Vec<Data>) {
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    let (priv_key, pub_key) = ed25519::keypair(&key);

    let ex = tuna_compiler::compile(code).unwrap();
    let g = tuna_interpreter::Globals::new(
        &ex.schemas,
        &ex.stores,
        &ex.fns,
        &priv_key,
        &pub_key
    );
    g.execute(&func.to_string(), args).await.unwrap();
}

#[tokio::test]
async fn can_run_an_empty_function() {
    exec_test("func noop() {}", "noop", vec![]).await;
}

#[test]
fn should_allow_global_objects() {
    // it("should allow a global object", tunaTest("succeed", `const obj = {}`))
    let ex = tuna_compiler::compile(r#"
    const obj1 = {}
    const obj2 = {}
    "#).unwrap();
    assert_eq!(2, ex.stores.len());
}

#[tokio::test]
async fn should_allow_arg_in_function() {
    exec_test(r#"
    func argy(a) {

    }
    "#, "argy", vec![Data::None]).await;    
}