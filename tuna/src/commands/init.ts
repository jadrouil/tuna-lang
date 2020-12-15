
import { GluegunCommand } from 'gluegun'
import { CONDER_CNTR } from '../conder_version'


const command: GluegunCommand = {
  name: 'init',
  run: async toolbox => {
    const { print } = toolbox
    print.info("pulling necessary containers")
    await toolbox.system.run(`docker pull ${CONDER_CNTR} && docker pull mongo:4.4 && docker pull bitnami/etcd`)
    print.info("done!")
  },
}

module.exports = command
