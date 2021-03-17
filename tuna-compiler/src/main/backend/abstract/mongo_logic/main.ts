import { MapTransform, Transformer } from './../compilers';
import { ActionSequence, calculate_lock_requirements, LockRequirements } from './lock_calculation';
import { MongoNodeSet } from '../globals/mongo';
import { TargetNodeSet, NodeSet } from "../IR";
import { MONGO_ACTION_SUMMARIZER } from './action_summarizer';
import { FunctionDescription } from '../function';

type LockCalculator = MapTransform<FunctionDescription<TargetNodeSet<MongoNodeSet>>, LockRequirements>


/**
 * For some mutation of global state turning g_x -> g_x',
 * The mutation can be said to be dependent on some set of global state G which may or may not include g_x.
 * If G is not empty, all globals within G must be locked. If G[y] = g_x, you must have a write lock.
 * 
 * Transitive dependencies can be calculated by keeping track of dependencies on global state through variables.
 * If execution is dependent on global state, then all subsequent execution is dependent on global state.
 * 
 * Note: A condition mutation of global state can be reduced to a definite mutation of global state (i.e. g' = g).
 *  if g.mutate
 *      g = 0
 *  else
 *      do nothing
 * 
 * can be rewritten as
 * 
 *  g_next = 0
 *  if !g.mutate
 *      g_next = g
 *  g = g_next
 * 
 * @param input: Some Sequential Computation
 */
export const MONGO_UNPROVIDED_LOCK_CALCULATOR: LockCalculator = Transformer.Map(input => calculate_lock_requirements(MONGO_ACTION_SUMMARIZER.run(input)))


