
import { GluegunCommand } from 'gluegun'


const command: GluegunCommand = {
  name: 'init',
  run: async toolbox => {
    const { print } = toolbox
    print.info("pulling necessary containers")
    await toolbox.system.run(`docker pull condersystems/sps:0.1.4 && docker pull mongo:4.4`)
    print.info("done!")
  },
}

module.exports = command
