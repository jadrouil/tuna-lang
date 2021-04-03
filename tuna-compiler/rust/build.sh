#!/bin/zsh
set -e

cd interpreter
cargo build
cargo test
cat ops.ts > bindings.ts
cat schemas.ts >> bindings.ts
cat data.ts >> bindings.ts
mv bindings.ts ../
rm ops.ts schemas.ts data.ts 

cd ../tunar
cargo build
cargo test
cat runnable.ts >> ../bindings.ts
rm runnable.ts

cd ..
mv bindings.ts ../src/main/backend/ops

