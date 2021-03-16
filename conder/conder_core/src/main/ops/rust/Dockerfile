FROM rust:1.48 as builder

RUN USER=root cargo new --bin app

WORKDIR /app
# create a new empty shell project

# copy over your manifests just to build dependencies
COPY ./Cargo.lock ./Cargo.lock
COPY ./Cargo.toml ./Cargo.toml

# this build step will cache your dependencies
RUN rustup component add rustfmt --toolchain 1.48.0-x86_64-unknown-linux-gnu
RUN cargo build --release

COPY ./src/ ./src/

# build for release
RUN rm ./target/release/deps/app*
RUN cargo build --release


FROM debian:buster-slim
RUN apt-get update && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/app /usr/local/bin/app
EXPOSE 8080
CMD ["app", "8080"]