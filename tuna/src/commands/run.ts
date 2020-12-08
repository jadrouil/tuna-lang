import { ServerEnv } from 'conder_core/dist/src/main/ops';

import { GluegunToolbox, GluegunCommand, print } from 'gluegun'
import * as child_process from 'child_process'
import { TUNA_LOCAL_COMPILER } from 'tuna-compiler'
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
            
        const client = await mongodb.MongoClient.connect(
            `mongodb://localhost:27017`,
            { useUnifiedTopology: true }
        ).catch((e) => {console.error(e); process.exit(1)});
        
        const db = client.db("conduit");
        
    
        Object.keys(output.STORES).forEach(storeName => db.createCollection(storeName))
        
    
        await db.listCollections().toArray()
        const mongoAddress = child_process.execSync(`docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${mongoname}`, {encoding: "utf-8"}).trim()
        const string_env: ServerEnv = {
            MONGO_CONNECTION_URI: `mongodb://${mongoAddress}`,
            ...output
        };
        info("starting server...")
        
        child_process.execSync(
            `docker run --rm -d -p 7213:8080 ${Object.keys(string_env).map(k => `-e ${k}`).join(' ')} --name tuna-run condersystems/sps:0.1.3`, 
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

module.exports = command
