/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import moment from 'moment';
import dateMath from '@elastic/datemath';
import { Chart } from './ChartTypes';

/**
 * Transform PPL datarows/schema format to chart data
 * PPL queries with `stats count() by span()` return data in this format
 */
function transformPPLDatarowsToChartData(
  results: { schema: Array<{ name: string; type: string }>; datarows: any[][] },
  timeFieldName: string = '@timestamp'
): Chart | undefined {
  if (!results.schema || !Array.isArray(results.datarows) || results.datarows.length === 0) {
    return undefined;
  }

  // Find the span column (time bucket) and count column
  const schema = results.schema;
  let spanColumnIndex = -1;
  let countColumnIndex = -1;
  let spanColumnName = '';

  schema.forEach((col, index) => {
    // Look for span column (usually named like "span(@timestamp, 1h)" or similar)
    if (col.name.toLowerCase().includes('span') || col.type === 'timestamp') {
      spanColumnIndex = index;
      spanColumnName = col.name;
    }
    // Look for count column
    if (col.name.toLowerCase().includes('count') || col.name === 'count()') {
      countColumnIndex = index;
    }
  });

  // If we didn't find specific columns, assume first is time, second is count
  if (spanColumnIndex === -1) spanColumnIndex = 0;
  if (countColumnIndex === -1) countColumnIndex = 1;

  if (spanColumnIndex === -1 || countColumnIndex === -1) {
    return undefined;
  }

  // Extract values from datarows
  const values = results.datarows
    .map((row) => {
      const timestamp = row[spanColumnIndex];
      const count = Number(row[countColumnIndex]) || 0;

      let x: number;
      if (timestamp instanceof Date) {
        x = timestamp.getTime();
      } else if (typeof timestamp === 'number') {
        x = timestamp;
      } else if (typeof timestamp === 'string') {
        const parsedDate = moment(timestamp);
        x = parsedDate.isValid() ? parsedDate.valueOf() : 0;
      } else {
        return null;
      }

      if (Number.isFinite(x) && Number.isFinite(count) && x > 0) {
        return { x, y: count };
      }
      return null;
    })
    .filter((point: any): point is { x: number; y: number } => point !== null)
    .sort((a: any, b: any) => a.x - b.x);

  if (values.length === 0) {
    return undefined;
  }

  // Calculate interval from values
  let intervalMs = 0;
  if (values.length > 1) {
    intervalMs = values[1].x - values[0].x;
  } else if (values.length === 1) {
    // For single data point, use a default interval of 1 hour to ensure chart renders properly
    intervalMs = 3600000; // 1 hour in milliseconds
  }

  const interval = moment.duration(intervalMs);
  const minTime = moment(values[0].x);
  const maxTime = moment(values[values.length - 1].x);
  
  // For single data point, extend the max time slightly to ensure proper domain calculation
  if (values.length === 1) {
    maxTime.add(intervalMs, 'milliseconds');
  }

  return {
    values,
    xAxisOrderedValues: values.map((point) => point.x),
    xAxisFormat: { id: 'date', params: { pattern: 'YYYY-MM-DD HH:mm' } },
    xAxisLabel: timeFieldName || 'Time',
    yAxisLabel: 'Count',
    ordered: {
      date: true,
      interval,
      intervalOpenSearchUnit: intervalMs >= 86400000 ? 'd' : intervalMs >= 3600000 ? 'h' : intervalMs >= 60000 ? 'm' : 's',
      intervalOpenSearchValue: intervalMs >= 86400000 
        ? Math.round(intervalMs / 86400000)
        : intervalMs >= 3600000
        ? Math.round(intervalMs / 3600000)
        : intervalMs >= 60000
        ? Math.round(intervalMs / 60000)
        : Math.round(intervalMs / 1000),
      min: minTime,
      max: maxTime,
    },
  };
}

/**
 * Transform PPL query aggregation results into chart data format
 * This handles PPL's native datarows/schema format and Elasticsearch aggregations format
 */
export function transformPPLAggregationToChartData(
  results: any,
  timeFieldName: string = '@timestamp'
): Chart | undefined {
  if (!results) {
    return undefined;
  }

  // Handle PPL native format (datarows + schema)
  if (results.schema && Array.isArray(results.datarows)) {
    return transformPPLDatarowsToChartData(results, timeFieldName);
  }

  // Handle Elasticsearch aggregations format
  if (!results.aggregations) {
    return undefined;
  }

  // Try to find histogram buckets in various possible locations
  const buckets =
    results.aggregations.histogram?.buckets ||
    results.aggregations.date_histogram?.buckets ||
    results.aggregations.ppl_histogram?.buckets ||
    results.aggregations.count_over_time?.buckets ||
    results.aggregations.combined_value?.buckets ||
    [];

  if (!Array.isArray(buckets) || buckets.length === 0) {
    return undefined;
  }

  // Calculate interval from buckets
  let intervalMs = 0;
  if (buckets.length > 1) {
    const firstKey = buckets[0].key || buckets[0].key_as_string;
    const secondKey = buckets[1].key || buckets[1].key_as_string;
    
    // Handle both numeric timestamps and date strings
    const firstTime = typeof firstKey === 'number' ? firstKey : moment(firstKey).valueOf();
    const secondTime = typeof secondKey === 'number' ? secondKey : moment(secondKey).valueOf();
    
    intervalMs = secondTime - firstTime;
  } else if (buckets.length === 1) {
    // For single bucket, use a default interval of 1 hour to ensure chart renders properly
    intervalMs = 3600000; // 1 hour in milliseconds
  }

  // Create interval duration
  const interval = moment.duration(intervalMs);

  // Get min/max from buckets
  const firstBucket = buckets[0];
  const lastBucket = buckets[buckets.length - 1];
  
  const firstKey = firstBucket.key || firstBucket.key_as_string;
  const lastKey = lastBucket.key || lastBucket.key_as_string;
  
  const minTime = typeof firstKey === 'number' 
    ? moment(firstKey) 
    : moment(firstKey);
  const maxTime = typeof lastKey === 'number' 
    ? moment(lastKey) 
    : moment(lastKey);
  
  // For single bucket, extend the max time slightly to ensure proper domain calculation
  if (buckets.length === 1) {
    maxTime.add(intervalMs, 'milliseconds');
  }

  // Create chart data structure that matches Chart interface
  const values = buckets
    .map((bucket: any) => {
      const timestamp = bucket.key || bucket.key_as_string || bucket.keyAsString;
      const count = Number(
        bucket.doc_count ?? bucket.count ?? bucket['count()'] ?? bucket.total ?? bucket.value ?? 0
      ) || 0;

      let x: number;
      if (timestamp instanceof Date) {
        x = timestamp.getTime();
      } else if (typeof timestamp === 'number') {
        x = timestamp;
      } else {
        const parsedDate = moment(timestamp);
        x = parsedDate.isValid() ? parsedDate.valueOf() : 0;
      }

      if (Number.isFinite(x) && Number.isFinite(count) && x > 0) {
        return { x, y: count };
      }
      return null;
    })
    .filter((point: any): point is { x: number; y: number } => point !== null)
    .sort((a: any, b: any) => a.x - b.x);

  if (values.length === 0) {
    return undefined;
  }

  return {
    values,
    xAxisOrderedValues: values.map((point) => point.x),
    xAxisFormat: { id: 'date', params: { pattern: 'YYYY-MM-DD HH:mm' } },
    xAxisLabel: timeFieldName || 'Time',
    yAxisLabel: 'Count',
    ordered: {
      date: true,
      interval,
      intervalOpenSearchUnit: intervalMs >= 86400000 ? 'd' : intervalMs >= 3600000 ? 'h' : intervalMs >= 60000 ? 'm' : 's',
      intervalOpenSearchValue: intervalMs >= 86400000 
        ? Math.round(intervalMs / 86400000)
        : intervalMs >= 3600000
        ? Math.round(intervalMs / 3600000)
        : intervalMs >= 60000
        ? Math.round(intervalMs / 60000)
        : Math.round(intervalMs / 1000),
      min: minTime,
      max: maxTime,
    },
  };
}

/**
 * Build PPL query with histogram aggregation and time range filter
 * This adds a date_histogram aggregation and time range where clause to the base PPL query
 */
export function buildPPLHistogramQuery(
  baseQuery: string,
  timeField: string = '@timestamp',
  interval: string = 'auto',
  timeRange?: { from: string | number; to: string | number }
): string {
  if (baseQuery.trim() === '') {
    return '';
  }

  // Calculate interval if auto
  let calculatedInterval = interval;
  if (interval === 'auto') {
    // Default to 1 hour for auto
    calculatedInterval = '1h';
  }

  // Build time filter where clause if time range is provided
  // Format dates similar to how FilterUtils does it
  // Use dateMath.parse to handle relative time strings like 'now-15m'
  let timeFilterClause = '';
  if (timeRange && timeRange.from && timeRange.to) {
    // Parse relative time strings (e.g., 'now-15m') or absolute dates
    const fromParsed = typeof timeRange.from === 'string' 
      ? dateMath.parse(timeRange.from) 
      : moment(timeRange.from);
    const toParsed = typeof timeRange.to === 'string'
      ? dateMath.parse(timeRange.to, { roundUp: true })
      : moment(timeRange.to);
    
    // Check if parsing was successful
    if (!fromParsed || !toParsed || !fromParsed.isValid() || !toParsed.isValid()) {
      console.warn('[buildPPLHistogramQuery] Failed to parse time range:', {
        from: timeRange.from,
        to: timeRange.to,
        fromParsed: fromParsed?.isValid(),
        toParsed: toParsed?.isValid(),
      });
    } else {
      console.log('[buildPPLHistogramQuery] Building time filter:', {
        timeRange,
        fromMoment: fromParsed.format(),
        toMoment: toParsed.format(),
        fromMomentUTC: fromParsed.utc().format(),
        toMomentUTC: toParsed.utc().format(),
        timeField,
      });
      
      // Format as YYYY-MM-DD HH:mm:ss.SSS (matching FilterUtils format)
      const fromDate = fromParsed.utc().format('YYYY-MM-DD HH:mm:ss.SSS');
      const toDate = toParsed.utc().format('YYYY-MM-DD HH:mm:ss.SSS');
      
      // Use uppercase WHERE and AND to match PPLFilterUtils format
      timeFilterClause = `WHERE \`${timeField}\` >= '${fromDate}' AND \`${timeField}\` <= '${toDate}'`;
      
      console.log('[buildPPLHistogramQuery] Time filter clause:', {
        timeFilterClause,
        fromDate,
        toDate,
      });
    }
  }

  // Check if query already has stats command with span
  const hasStatsWithSpan = /stats\s+.*span\s*\(/i.test(baseQuery);
  
  if (hasStatsWithSpan) {
    // Replace existing span interval with our interval
    // Match span(timeField, interval) and replace interval
    const queryWithUpdatedSpan = baseQuery.replace(
      /span\s*\(\s*[^,]+,\s*[^)]+\s*\)/i,
      `span(${timeField}, ${calculatedInterval})`
    );
    // Insert time filter before stats command if not already present
    // Check for both uppercase and lowercase WHERE clauses
    if (timeFilterClause && !/where/i.test(queryWithUpdatedSpan)) {
      return queryWithUpdatedSpan.replace(
        /(\s*\|\s*stats)/i,
        ` | ${timeFilterClause}$1`
      );
    }
    return queryWithUpdatedSpan;
  } else {
    // Check if query ends with a pipe or not
    const trimmedQuery = baseQuery.trim();
    const needsPipe = !trimmedQuery.endsWith('|');
    
    // Build the final query parts
    const parts: string[] = [trimmedQuery];
    
    // Add pipe if needed
    if (needsPipe) {
      parts.push('');
    }
    
    // Add time filter if provided
    if (timeFilterClause) {
      parts.push(timeFilterClause);
    }
    
    // Add stats command
    parts.push(`stats count() by span(${timeField}, ${calculatedInterval})`);
    
    // Join with pipes, filtering out empty strings
    return parts.filter(p => p !== '').join(' | ');
  }
}

