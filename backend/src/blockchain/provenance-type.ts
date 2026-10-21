/**
 * The provenance "type" filter as a reader means it, not as the record happens to be stored.
 *
 * Prudence's PDP decisions reach Ernest two ways. Through the ingestor or Kafka they are
 * `policy_decision` events. Through the direct transport (POST /api/inferences, Prudence's
 * default) they are stored as `inference` with `metadata.stage = governance_decision`, since
 * that endpoint has no type of its own. Filtering on the stored type alone made those decisions
 * invisible under "Policy decision" and listed them as model inferences.
 *
 * Returns the MongoDB condition for `type`, given where the stored type and the metadata stage
 * live in the collection being queried (blocks: `data.type`; batched events: `type`).
 */
export const GOVERNANCE_DECISION_STAGE = 'governance_decision';

export function provenanceTypeCondition(
  type: string,
  paths: { type: string; stage: string },
): Record<string, any> {
  if (type === 'policy_decision') {
    return {
      $or: [
        { [paths.type]: 'policy_decision' },
        { [paths.type]: 'inference', [paths.stage]: GOVERNANCE_DECISION_STAGE },
      ],
    };
  }
  if (type === 'inference') {
    return { [paths.type]: 'inference', [paths.stage]: { $ne: GOVERNANCE_DECISION_STAGE } };
  }
  return { [paths.type]: type };
}
