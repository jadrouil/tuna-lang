import { ServerEnv, StrongServerEnv } from './../env';
import * as fs from 'fs'
import * as child_process from 'child_process'
import * as mongodb from "mongodb";
import * as etcd from 'etcd3'

import "isomorphic-fetch";
import { InterpreterType } from '../bindings';

export namespace Test {
    class UniqueInstance {
      private static next_port = new Uint16Array(new SharedArrayBuffer(16));
      public readonly port: number
      constructor() {
        this.port = this.get_next_port()
      }
      
      protected get_next_port(): number {
        return 8080 + Atomics.add(UniqueInstance.next_port, 0, 1);
      }
    }
    const byteToHex: string[] = [];

    for (let n = 0; n <= 0xff; ++n)
    {
        const hexOctet = n.toString(16).padStart(2, "0");
        byteToHex.push(hexOctet);
    }
    
    function hex(arrayBuffer: ArrayBufferLike)
    {
        const buff = new Uint8Array(arrayBuffer);
        const hexOctets = []; // new Array(buff.length) is even faster (preallocates necessary array size), then use hexOctets[i] instead of .push()
    
        for (let i = 0; i < buff.length; ++i)
            hexOctets.push(byteToHex[buff[i]]);
    
        return hexOctets.join(" ");
    }
    export class Server extends UniqueInstance {
        private process: child_process.ChildProcess;
        private constructor(env: StrongServerEnv) {
          super()
          const string_env: Partial<ServerEnv> = {};
          for (const key in env) {
            switch (key as keyof StrongServerEnv) {
              case "PUBLIC_KEY":
              case "PRIVATE_KEY":
                //@ts-ignore
                string_env[key] = hex(env[key])
                break
              default:
                    //@ts-ignore
                string_env[key] =
                //@ts-ignore
                  typeof env[key] === "string" ? env[key] : JSON.stringify(env[key]);
            }
            
          }
          this.process = child_process.exec(`./app ${this.port}`, {
            cwd: `./src/main/ops/rust/target/debug`,
            env: string_env,
          });
          this.process.stdout.pipe(process.stdout);
          this.process.stderr.pipe(process.stderr);
        }
      
        public static async start(env: StrongServerEnv): Promise<Server> {
          // portAssignments.set(8080, this.process);
          const ret = new Server(env);
          let retry = true;
          while (retry) {
            try {
              await ret.noopRequest();
              retry = false;
            } catch (e) {
              retry = true;
            }
          }
          return ret;
        }
      
        async noopRequest() {
          const body = JSON.stringify({ kind: "Noop" });
          const res = await fetch(`http://localhost:${this.port}`, {
            method: "PUT",
            body,
            headers: {
              "content-type": "application/json",
              "content-length": `${body.length}`,
            },
          }).then((data) => data.json());
      
          expect(res).toEqual(null);
        }
      
        kill() {
          this.process.kill("SIGTERM");
        }
      
        async invoke(
          name: string,
          ...arg: InterpreterType[]
        ) {
          const body = JSON.stringify({ kind: "Exec", data: { proc: name, arg } });
          return fetch(`http://localhost:${this.port}/`, {
            method: "PUT",
            body,
            headers: {
              "content-type": "application/json",
              "content-length": `${body.length}`,
            },
          }).then((data) => {
            if (data.ok){
              return data.json()
            }
            throw Error(data.statusText)
          });
        }
      }
      
      export type Stores = Pick<StrongServerEnv, "STORES">;
      
      export class Mongo extends UniqueInstance {
        private constructor() {
          super()
          child_process.execSync(
            `docker run --rm --name mongo${this.port} -d  --mount type=tmpfs,destination=/data/db -p ${this.port}:27017 mongo:4.4 `
          );
        }
      
        public static async start(stores: Stores): Promise<Test.Mongo> {
          const ret = new Test.Mongo();
          const client = await mongodb.MongoClient.connect(
            `mongodb://localhost:${ret.port}`,
            { useUnifiedTopology: true}
          );
          const storeKeys= Object.keys(stores.STORES)
          const db = client.db("statefultest");

          const creates = storeKeys.map((k) => db.createCollection(k));
          
          await Promise.all(creates).then(() => db.listCollections()).catch((err)=> console.error(err))
          
          return ret;
        }
        public kill() {
          child_process.execSync(`docker kill mongo${this.port}`);
        }
      }
      
      

      export class EtcD extends UniqueInstance {

        public static async start(): Promise<Test.EtcD> {
          const process = new EtcD()
          const backoff: etcd.IOptions["faultHandling"]["watchBackoff"] = {
            duration: () => 3000,
            next: () => backoff
          }

          const client = new etcd.Etcd3({hosts: `localhost:${process.port}`, faultHandling: {
              watchBackoff: backoff
          }})
          await client.put("a").value("b").exec()
          await client.delete().key("a").exec()
          return process
        }
        private constructor() {
          super()
          const second_port = this.get_next_port()
          child_process.execSync(
            `docker run -it --rm -d --name etcd${this.port} \
            --env ALLOW_NONE_AUTHENTICATION=yes -p ${this.port}:2379 -p ${second_port}:2380 \
            bitnami/etcd`
          );
        }

        public kill() {
          child_process.execSync(`docker kill etcd${this.port}`)
        }
      }
}