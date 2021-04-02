import * as fs from 'fs'
import * as child_process from 'child_process'
import * as mongodb from "mongodb";
import * as binds from './bindings'
import { release } from 'process';


export type Procedures = Record<string, binds.Op[]>

export * from './local_run/utilities'
export * from './bindings'
export * as Utils from './utils'
export * from './env'

type Op<K extends binds.Op["kind"]> = Extract<binds.Op, {kind: K}>
type OpFactory<K extends binds.Op["kind"]> = Op<K>["data"] extends null ? {kind: K, data: null} : (data: Op<K>["data"]) => Op<K>

export type OpWriter = {
    [K in binds.Op["kind"]]: OpFactory<K>
}
function creator<O extends binds.Op>(k: O["kind"]): (data: any) => O {
    return (data) => ({kind: k, data} as O)
}
function stat<O extends binds.Op>(k: O["kind"]): O {
    return {kind: k, data: null} as O
}

export const ow: OpWriter = {
    negatePrev: {kind: "negatePrev", data: null},
    stackTopMatches: creator("stackTopMatches"),
    isLastNone: {kind: "isLastNone", data: null},
    tryGetField: creator("tryGetField"),
    overwriteHeap: creator("overwriteHeap"),
    noop: {kind: "noop", data: null},
    raiseError: creator("raiseError"),
    setField: creator("setField"),
    setSavedField: creator("setSavedField"),
    stringConcat: creator("stringConcat"),
    getField: creator("getField"),
    getType: {kind: "getType", data: null},
    getSavedField: creator("getSavedField"),
    getKeys: {kind: "getKeys", data: null},
    deleteSavedField: creator("deleteSavedField"),
    pArrayPush: creator("pArrayPush"),
    plus: {kind: "plus", data: null},
    popArray: {kind: "popArray", data: null},
    pushSavedField: creator("pushSavedField"),
    popStack: {kind: "popStack", data: null},
    fieldAccess: creator("fieldAccess"),
    fieldExists: {kind: "fieldExists", data: null},
    flattenArray: {kind: "flattenArray", data: null},
    toBool: {kind: "toBool", data: null},
    truncateHeap: creator("truncateHeap"),
    offsetOpCursor: creator("offsetOpCursor"),
    conditonallySkipXops: creator("conditonallySkipXops"),
    copyFieldFromHeap: creator("copyFieldFromHeap"),
    copyFromHeap: creator('copyFromHeap'),
    repackageCollection: stat("repackageCollection"),
    returnStackTop: stat("returnStackTop"),
    returnVariable: creator("returnVariable"),
    returnVoid: stat("returnVoid"),
    enforceSchemaInstanceOnHeap: creator("enforceSchemaInstanceOnHeap"),
    enforceSchemaOnHeap: creator("enforceSchemaOnHeap"),
    equal: stat("equal"),
    extractFields: creator("extractFields"),
    instantiate: creator("instantiate"),
    invoke: creator("invoke"),
    moveStackToHeapArray: creator("moveStackToHeapArray"),
    moveStackTopToHeap: stat("moveStackTopToHeap"),
    arrayLen: stat("arrayLen"),
    arrayPush: stat("arrayPush"),
    assertHeapLen: creator("assertHeapLen"),
    assignPreviousToField: creator("assignPreviousToField"),
    nDivide: stat("nDivide"),
    nMinus: stat("nMinus"),
    nMult: stat("nMult"),
    ndArrayLen: stat("ndArrayLen"),
    setNestedField: creator("setNestedField"),
    signRole: stat("signRole"),
    less: stat("less"),
    lesseq: stat("lesseq"),
    boolAnd: stat("boolAnd"),
    boolOr: stat("boolOr")

}
