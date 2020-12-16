import { GluegunToolbox, GluegunCommand, print } from 'gluegun'
import { TUNA_LOCAL_COMPILER } from 'tuna-compiler'


const command: GluegunCommand = {
  name: 'build',
  run: async (toolbox: GluegunToolbox) => {
    const {
      print: { info, error },
      filesystem,
      parameters
    } = toolbox
    
    
    const conduit = filesystem.read("main.tuna")
    if (conduit === undefined) {
      error(`Could not find required file main.tuna`)
      process.exit(1)
    }
    try {
        info("compiling...")
        const output = TUNA_LOCAL_COMPILER.run(conduit)
        const write_to = parameters.first ? parameters.first : "main" + ".can"
        filesystem.write(write_to, output)
        info(`result in ${write_to}`)
    } catch (e) {
        print.error(e)
        process.exit(1)
    }
  }
}

module.exports = command
