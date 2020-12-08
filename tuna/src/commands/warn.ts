import { GluegunToolbox, GluegunCommand, print } from 'gluegun'
import { TUNA_TO_LOCKS } from 'tuna-compiler'

const command: GluegunCommand = {
  name: 'warn',
  run: async (toolbox: GluegunToolbox) => {
    const {
      print: { info, error, warning, success },
      filesystem,
    } = toolbox
    
    
    const conduit = filesystem.read("main.tuna")
    if (conduit === undefined) {
      error(`Could not find required file main.tuna`)
      process.exit(1)
    }
    try {
        info("quick compiling...")
        const output = TUNA_TO_LOCKS.run(conduit)
        const functions_with_lock_reqs: string[] = []
        output.forEach((reqs, func_name) => {
            if (reqs.size > 0) {
                const lock_requirements: string[] = []
                reqs.forEach((v, k) => {
                    lock_requirements.push(`\t-${v === "r" ? "read" : "write"} lock on ${k}`)
                })
                const s_lock_reqs = lock_requirements.join("\n")
                functions_with_lock_reqs.push(`Function ${func_name} requires: \n${s_lock_reqs}`)
            }
        })
        if (functions_with_lock_reqs.length > 0) {
            warning(`Found the following unsatisfied lock requirements: \n${functions_with_lock_reqs.join("\n")}`)
        } else {
            success("No unsatisfied lock requirements were found")
        }
    } catch (e) {
        print.error(e)
        process.exit(1)
    }

  }
}

module.exports = command
