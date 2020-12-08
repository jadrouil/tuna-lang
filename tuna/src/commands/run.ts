import { ServerEnv } from 'conder_core/dist/src/main/ops';

import { GluegunToolbox, GluegunCommand, print } from 'gluegun'
// import * from 'tuna-lang'
import * as child_process from 'child_process'
import { TUNA_LOCAL_COMPILER } from 'tuna-lang'
import * as mongodb from 'mongodb'

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
        info("starting mongo...")
        const mongoname = `mongodb-tuna`
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

        process.on("SIGINT", kill)
        process.on("SIGTERM", kill)
    
        const ipaddress = child_process.execSync(`docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${mongoname}`, {encoding: "utf-8"})
        
        const client = await mongodb.MongoClient.connect(
            `mongodb://localhost:${ipaddress}`,
            { useUnifiedTopology: true }
        ).catch((e) => {console.error(e); process.exit(1)});
        
        const db = client.db("conduit");
        
    
        Object.keys(output.STORES).forEach(storeName => db.createCollection(storeName))
        
    
        await db.listCollections().toArray()
        const string_env: ServerEnv = {
            MONGO_CONNECTION_URI: `mongodb://${ipaddress}`,
            ...output
        };
        
        info("starting server")
        
        child_process.execSync(
            `docker run --rm -d -t -p 7213:8080 ${Object.keys(string_env).map(k => `-e ${k}=$${k}`).join(' ')} --name tuna-run us.gcr.io/conder-systems-281115/sps:0.1.0`, 
            {
                env: {
                    ...string_env, 
                    ...process.env
                },

            }
        );
        killActions.push({name: "tearing down tuna server", action: () => child_process.execSync("docker kill conduit-run")})
        info("server available at: http://localhost:7213")
    } catch (e) {
        print.error(e)
        process.exit(1)
    }

  }
}

module.exports = command
