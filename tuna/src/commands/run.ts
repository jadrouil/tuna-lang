import { CONDER_CNTR } from './../conder_version';
import { ServerEnv } from 'conder_core/dist/src/main/ops';

import { GluegunToolbox, GluegunCommand, print } from 'gluegun'
import * as child_process from 'child_process'
import { TUNA_LOCAL_COMPILER } from 'tuna-compiler'
import * as mongodb from 'mongodb'
import { Etcd3 } from 'etcd3';
import * as etcd from 'etcd3'
import * as ed25519 from 'noble-ed25519'

const command: GluegunCommand = {
  name: 'run',
  run: async (toolbox: GluegunToolbox) => {
    const {
      print: { info, error },
      filesystem,
    } = toolbox
    
    
    const conduit = filesystem.read("main.tuna")
    if (conduit === undefined) {
      error(`Could not find required file main.tuna`)
      process.exit(1)
    }
    try {
        info("compiling...")
        const output = TUNA_LOCAL_COMPILER.run(conduit)
        info("starting mongo & etcd...")
        const mongoname = `mongodb-tuna`
        const readiers: Promise<any>[] = []
        const killActions: ({name: string, action: () => void})[] = []
        
        const startMongo = `docker run -d -p 27017:27017 --rm  --mount type=tmpfs,destination=/data/db --name ${mongoname} mongo:4.4`
        child_process.execSync(startMongo);
        killActions.push({name: "killing mongo", action: () => child_process.execSync(`docker kill ${mongoname}`)})
        const kill = () => {
            killActions.forEach(m => {
                try {
                    info(`${m.name}...`)
                    m.action()
                } catch(e) {
                    error(e)
                }
            })   
            process.exit(1)
        }

        const etcdPort = 2379
        const etcname= `etcdtuna`
        const etclocation = `localhost:${etcdPort}`
        child_process.execSync(
            `docker run -it --rm -d --name ${etcname} \
            --env ALLOW_NONE_AUTHENTICATION=yes -p ${etcdPort}:2379 -p ${etcdPort + 1}:2380 \
            bitnami/etcd`
        )
        killActions.push({name: "killing etcd", action: () => child_process.execSync(`docker kill ${etcname}`)})
            
        process.on("SIGINT", kill)
        process.on("SIGTERM", kill)
            
        const client = await mongodb.MongoClient.connect(
            `mongodb://localhost:27017`,
            { useUnifiedTopology: true }
        ).catch((e) => {console.error(e); process.exit(1)});
        const backoff: etcd.IOptions["faultHandling"]["watchBackoff"] = {
            duration: () => 3000,
            next: () => backoff
        }
        const e_client = new Etcd3({hosts: etclocation, faultHandling: {watchBackoff: backoff}})
        readiers.push(e_client.put("a").value("b").exec().then(() =>e_client.delete().key("a").exec()))
        
        const db = client.db("conduit");
                
        Object.keys(output.STORES).forEach(storeName => db.createCollection(storeName))
        
        readiers.push(db.listCollections().toArray())
        await (Promise.all(readiers).catch(e => {error(e); throw e}))
        const mongoAddress = child_process.execSync(`docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${mongoname}`, {encoding: "utf-8"}).trim()
        const etcAddress = child_process.execSync(`docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${etcname}`, {encoding: "utf-8"}).trim()
        const private_key = ed25519.utils.randomPrivateKey()
        const public_key = await ed25519.getPublicKey(private_key)
        
        const string_env: ServerEnv = {
            MONGO_CONNECTION_URI: `mongodb://${mongoAddress}`,
            ETCD_URL: `http://${etcAddress}:${etcdPort}`,
            PUBLIC_KEY: hex(public_key),
            PRIVATE_KEY: hex(new Uint8Array([...private_key, ...public_key])),
            ...output
        };
        info("starting server...")
        
        child_process.execSync(
            `docker run --rm -d -p 7213:8080 ${Object.keys(string_env).map(k => `-e ${k}`).join(' ')} --name tuna-run ${CONDER_CNTR}`, 
            {
                env: {
                    ...string_env, 
                    ...process.env
                },
            }
        );
        killActions.push({name: "tearing down tuna server", action: () => child_process.execSync("docker kill tuna-run")})
        info("server available at: http://localhost:7213")
    } catch (e) {
        print.error(e)
        process.exit(1)
    }

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

module.exports = command
