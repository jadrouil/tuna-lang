export type Op = {kind: "negatePrev", data: null} |
{kind: "stackTopMatches", data: {
    schema: string,
}} |
{kind: "isLastNone", data: null} |
{kind: "tryGetField", data: string} |
{kind: "overwriteHeap", data: number} |
{kind: "raiseError", data: string} |
{kind: "noop", data: null} |
{kind: "setField", data: {
    field_depth: number,
}} |
{kind: "setSavedField", data: {
    field_depth: number,
    index: number,
}} |
{kind: "stringConcat", data: {
    nStrings: number,
    joiner: string,
}} |
{kind: "getField", data: {
    field_depth: number,
}} |
{kind: "getSavedField", data: [number, number]} |
{kind: "deleteSavedField", data: {
    field_depth: number,
    index: number,
}} |
{kind: "pushSavedField", data: {
    field_depth: number,
    index: number,
}} |
{kind: "fieldExists", data: null} |
{kind: "truncateHeap", data: number} |
{kind: "offsetOpCursor", data: {
    offset: number,
    fwd: boolean,
}} |
{kind: "conditonallySkipXops", data: number} |
{kind: "returnVariable", data: number} |
{kind: "returnStackTop", data: null} |
{kind: "returnVoid", data: null} |
{kind: "copyFromHeap", data: number} |
{kind: "fieldAccess", data: string} |
{kind: "enforceSchemaOnHeap", data: {
    schema: string,
    heap_pos: number,
}} |
{kind: "moveStackTopToHeap", data: null} |
{kind: "popStack", data: null} |
{kind: "instantiate", data: InterpreterType} |
{kind: "popArray", data: null} |
{kind: "flattenArray", data: null} |
{kind: "toBool", data: null} |
{kind: "moveStackToHeapArray", data: number} |
{kind: "arrayPush", data: null} |
{kind: "pArrayPush", data: {
    stack_offset: number,
}} |
{kind: "assignPreviousToField", data: string} |
{kind: "arrayLen", data: null} |
{kind: "ndArrayLen", data: null} |
{kind: "setNestedField", data: string[]} |
{kind: "copyFieldFromHeap", data: [number, string[]]} |
{kind: "enforceSchemaInstanceOnHeap", data: {
    schema: Schema,
    heap_pos: number,
}} |
{kind: "extractFields", data: string[][]} |
{kind: "equal", data: null} |
{kind: "less", data: null} |
{kind: "lesseq", data: null} |
{kind: "boolAnd", data: null} |
{kind: "boolOr", data: null} |
{kind: "assertHeapLen", data: number} |
{kind: "repackageCollection", data: null} |
{kind: "plus", data: null} |
{kind: "nMinus", data: null} |
{kind: "nDivide", data: null} |
{kind: "nMult", data: null} |
{kind: "getKeys", data: null} |
{kind: "invoke", data: {
    name: string,
    args: number,
}} |
{kind: "signRole", data: null} |
{kind: "getType", data: null};export type Schema = {kind: "Object", data: Record<string, Schema>} |
{kind: "Role", data: [string, Schema[]]} |
{kind: "Array", data: Schema[]} |
{kind: "Union", data: Schema[]} |
{kind: "Map", data: Schema[]} |
{kind: "TypeAlias", data: string} |
{kind: "double", data: null} |
{kind: "int", data: null} |
{kind: "string", data: null} |
{kind: "bool", data: null} |
{kind: "Any", data: null} |
{kind: "none", data: null};export type InterpreterType = number |
number |
boolean |
string |
InterpreterType[] |
{ [K in string]: InterpreterType} |
null;export interface Runnable {
    main: Op[],
    lookups: {
            schemas: Record<string, Schema>,
            functions: Record<string, Op[]>
        }
        ,
}