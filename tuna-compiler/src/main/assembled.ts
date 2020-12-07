import {Transformer, Manifest} from 'conder_core'
import {Parser} from './parser'
import {semantify } from './semantics'

export const TUNA_TO_MANIFEST = new Transformer<string, Manifest>(str => {
    const p = new Parser(str).parse()
    return semantify(p, false)
})