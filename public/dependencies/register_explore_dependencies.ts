/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { createGetterSetter } from '../../../../src/plugins/opensearch_dashboards_utils/public';
import type { ExplorePluginStart, QueryWithQueryAsString } from '../types';

/**
 * Query transformer function type from explore plugin
 */
export type QueryTransformerFunction = (query: {
  query: string;
  language: string;
  dataset?: any;
}) => QueryWithQueryAsString;

/**
 * Getter and setter for the query transformer function from explore plugin.
 * This allows alerting to use explore's query transformation utilities
 * without creating a hard dependency.
 */
export const [
  getQueryTransformer,
  setQueryTransformer,
] = createGetterSetter<QueryTransformerFunction>('queryTransformer');

/**
 * Register explore plugin dependencies.
 * This function is called during the alerting plugin's start lifecycle.
 * If explore is not available, it sets up a fallback transformer.
 *
 * @param start - Optional explore plugin start contract
 */
export const registerExploreDependencies = (start?: ExplorePluginStart) => {
  if (!start || !start.getQueryWithSource) {
    // Fallback: return query as-is if explore is not available
    setQueryTransformer(({ query }) => ({
      query,
      language: 'PPL',
    }));
    return;
  }

  // Use explore's query transformation utility
  setQueryTransformer(start.getQueryWithSource);
};
