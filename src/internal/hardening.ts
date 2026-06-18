// Query-shape hardening as graphql-js validation rules, applied before execution.
// Introspection can be disabled (prod), and a maximum selection depth enforced.

import { GraphQLError, NoSchemaIntrospectionCustomRule, specifiedRules, type ValidationRule } from "graphql";

export interface HardeningOptions {
  /** Allow introspection queries. Default true; set false in production. */
  readonly introspection?: boolean | undefined;
  /** Reject queries whose field nesting exceeds this depth. */
  readonly maxDepth?: number | undefined;
}

// Counts field nesting via enter/leave. Note: does not follow fragment spreads (a basic limit);
// fragment-spanning depth is a follow-up.
const depthLimitRule = (maxDepth: number): ValidationRule => (context) => {
  let depth = 0;
  return {
    Field: {
      enter: (node) => {
        depth += 1;
        if (depth > maxDepth) {
          context.reportError(new GraphQLError(`Query exceeds maximum depth of ${maxDepth}`, { nodes: [node] }));
        }
      },
      leave: () => {
        depth -= 1;
      },
    },
  };
};

export const validationRules = (options: HardeningOptions | undefined): ReadonlyArray<ValidationRule> => {
  const rules: Array<ValidationRule> = [...specifiedRules];
  if (options?.introspection === false) rules.push(NoSchemaIntrospectionCustomRule);
  if (options?.maxDepth !== undefined) rules.push(depthLimitRule(options.maxDepth));
  return rules;
};
