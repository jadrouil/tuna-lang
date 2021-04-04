use rand;
use rand_core::RngCore;
use crypto::ed25519;
use tuna_compiler;
use tuna_interpreter;

#[tokio::test]
async fn can_run_an_empty_function() {
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    let (priv_key, pub_key) = ed25519::keypair(&key);

    let ex = tuna_compiler::compile(r#"func noop() {}"#).unwrap();
    let g = tuna_interpreter::Globals::new(
        &ex.schemas,
        &ex.stores,
        &ex.fns,
        &priv_key,
        &pub_key
    );
    g.execute(&"noop".to_string(), vec![]).await.unwrap();
}
