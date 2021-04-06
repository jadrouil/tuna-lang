use rand;
use rand_core::RngCore;
use crypto::ed25519;
use tuna_compiler;
use tuna_interpreter;
use tuna_interpreter::data::*;
type Data =InterpreterType;

async fn exec_test(code: &str, func: &str, args: Vec<Data>) {
    data_test(code, func, args, Data::None).await;
}

async fn data_test(code: &str, func: &str, args: Vec<Data>, expect: Data) {
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
    let res = g.execute(&func.to_string(), args).await.unwrap();
    assert_eq!(expect, res);
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

#[tokio::test]
async fn should_allow_multiple_args_in_function() {
    exec_test(r#"
    func argy(a, b) {

    }
    "#, "argy", vec![Data::None, Data::None]).await;    
}

#[tokio::test]
async fn should_allow_public_functions() {
    exec_test(r#"
    pub func argy(a, b) {

    }
    "#, "argy", vec![Data::None, Data::None]).await;    
}

#[tokio::test]
async fn should_allow_empty_return() {
    exec_test(r#"
    pub func argy(a, b) {
        return
    }
    "#, "argy", vec![Data::None, Data::None]).await;    
}

#[ignore = "Global state implementation is being revisited"]
#[tokio::test]
async fn should_allow_mutation_of_global() {
    exec_test(r#"
    const gg = {}
    pub func fff(a) {
        gg.abc = a
        gg[a] = a
        gg['abc'] = a
    }
    "#, "fff", vec![Data::string("b".to_string())]).await;
}

#[tokio::test]
async fn should_return_none() {
    exec_test(r#"
    pub func a() {
        return none
    }
    "#, "a", vec![]).await
}

#[tokio::test]
async fn should_return_input() {
    data_test(r#"
    func f(a) {
        return a
    }"#, "f", vec![Data::int(1)], Data::int(1)).await;
}

#[tokio::test]
async fn should_return_literal() {
    data_test(r#"pub func a() {
        return []
    }"#, "a", vec![], Data::Array(vec![])).await;
}

#[tokio::test]
#[ignore = "Need to implement write side"]
async fn can_get_nested_keys() {
    data_test(r#"const gg = {}
    pub func fff(a) {
        return gg[a].field
    }"#, "fff", vec![], Data::None).await;
}

#[tokio::test]
async fn can_do_things_with_no_consequence() {
    exec_test(r#"
    pub func nope() {
        true
        false
        12
        'hello world'
        {}
    }"#, "nope", vec![]).await;
}

#[tokio::test]
async fn can_call_functions() {
    data_test(r#"

    pub func stringy() {
        return 'hello world'
    }

    func entry() {
        return stringy()
    }"#, "entry", vec![], Data::string("hello world".to_string())).await;
}