/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { AlertingHistogramChart } from './AlertingHistogramChart';
import { transformPPLAggregationToChartData, buildPPLHistogramQuery } from './utils/transformPPLToChartData';
import { runPPLPreview } from '../../containers/CreateMonitor/utils/pplAlertingHelpers';
import { Chart } from './utils/ChartTypes';
import { TimechartHeaderBucketInterval } from './TimechartHeader';

interface PplAlertingHistogramWrapperProps {
  query: string;
  httpClient: any;
  dataSourceId?: string;
  timeField?: string;
  config: any;
  data: any;
  services: any;
  showHistogram?: boolean;
  // Look back window props
  useLookBackWindow?: boolean;
  lookBackAmount?: number;
  lookBackUnit?: string;
}

export const PplAlertingHistogramWrapper: React.FC<PplAlertingHistogramWrapperProps> = ({
  query,
  httpClient,
  dataSourceId,
  timeField,
  config,
  data,
  services,
  showHistogram = true,
  useLookBackWindow = true,
  lookBackAmount = 1,
  lookBackUnit = 'hours',
}) => {
  const [chartData, setChartData] = useState<Chart | undefined>(undefined);
  const [bucketInterval, setBucketInterval] = useState<TimechartHeaderBucketInterval | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [interval, setInterval] = useState('auto');

  const executeQuery = useCallback(
    async (queryText: string, timeRange: { from: string; to: string }) => {
      if (!queryText || !queryText.trim()) {
        setChartData(undefined);
        return;
      }

      setIsLoading(true);
      try {
        // Debug: Log input parameters
        console.log('[PplAlertingHistogramWrapper] Input parameters:', {
          queryText,
          timeField,
          interval,
          timeRange,
          dataSourceId,
          timeRangeFrom: timeRange?.from,
          timeRangeTo: timeRange?.to,
          timeRangeFromType: typeof timeRange?.from,
          timeRangeToType: typeof timeRange?.to,
        });

        // First, test the base query without histogram to see if it works
        console.log('[PplAlertingHistogramWrapper] Testing base query first...');
        const baseQueryResp = await runPPLPreview(httpClient, {
          queryText: queryText,
          dataSourceId: dataSourceId,
        });
        console.log('[PplAlertingHistogramWrapper] Base query result:', {
          ok: baseQueryResp?.ok,
          error: baseQueryResp?.error,
          hasResp: !!baseQueryResp?.resp,
          hasSchema: !!baseQueryResp?.schema,
          hasDatarows: Array.isArray(baseQueryResp?.datarows),
        });

        // Test a simple stats query to see if stats works
        console.log('[PplAlertingHistogramWrapper] Testing simple stats query...');
        const simpleStatsQuery = `${queryText} | stats count()`;
        const simpleStatsResp = await runPPLPreview(httpClient, {
          queryText: simpleStatsQuery,
          dataSourceId: dataSourceId,
        });
        console.log('[PplAlertingHistogramWrapper] Simple stats query result:', {
          ok: simpleStatsResp?.ok,
          error: simpleStatsResp?.error,
          query: simpleStatsQuery,
        });

        // Build histogram query - this will add stats with span and time range filter
        const histogramQuery = buildPPLHistogramQuery(queryText, timeField, interval, timeRange);
        console.log('[PplAlertingHistogramWrapper] Built histogram query:', {
          originalQuery: queryText,
          histogramQuery: histogramQuery,
          queryLength: histogramQuery.length,
          hasTimeFilter: histogramQuery.includes('where'),
          hasStats: histogramQuery.includes('stats'),
        });

        // Execute PPL query using the same API as runPPLPreview
        console.log('[PplAlertingHistogramWrapper] Executing histogram query...');
        let resp = await runPPLPreview(httpClient, {
          queryText: histogramQuery,
          dataSourceId: dataSourceId,
        });

        console.log('[PplAlertingHistogramWrapper] Histogram query response:', {
          ok: resp?.ok,
          error: resp?.error,
          respType: typeof resp,
          respKeys: resp ? Object.keys(resp) : [],
          fullResp: JSON.stringify(resp).substring(0, 1000),
        });

        // Check if query failed - try without time filter as fallback
        if (resp?.ok === false && timeRange) {
          console.warn('[PplAlertingHistogramWrapper] Query with time filter failed, trying without time filter:', {
            error: resp.error,
            fullError: resp,
            query: histogramQuery,
          });
          
          // Try query without time filter
          const queryWithoutTimeFilter = buildPPLHistogramQuery(queryText, timeField, interval);
          console.log('[PplAlertingHistogramWrapper] Trying query without time filter:', {
            query: queryWithoutTimeFilter,
          });
          
          resp = await runPPLPreview(httpClient, {
            queryText: queryWithoutTimeFilter,
            dataSourceId: dataSourceId,
          });
          
          console.log('[PplAlertingHistogramWrapper] Query without time filter response:', {
            ok: resp?.ok,
            error: resp?.error,
            fullResp: JSON.stringify(resp).substring(0, 1000),
          });
        }

        // Check if query failed
        if (resp?.ok === false) {
          const errorMessage = resp.error || 'Unknown error';
          console.error('[PplAlertingHistogramWrapper] PPL query execution failed:', {
            error: errorMessage,
            fullError: resp,
            query: histogramQuery,
            dataSourceId: dataSourceId,
            httpClientExists: !!httpClient,
            httpClientType: typeof httpClient,
          });
          setChartData(undefined);
          return;
        }

        // Debug: Log response structure
        console.log('[PplAlertingHistogramWrapper] Query response:', {
          hasResp: !!resp,
          hasSchema: !!resp?.schema,
          hasDatarows: Array.isArray(resp?.datarows),
          datarowsCount: resp?.datarows?.length || 0,
          schema: resp?.schema,
          responseSample: JSON.stringify(resp).substring(0, 500),
        });

        // Transform response to chart data
        const transformedData = transformPPLAggregationToChartData(resp, timeField);
        
        if (transformedData) {
          console.log('[PplAlertingHistogramWrapper] Transformed chart data:', {
            valuesCount: transformedData.values.length,
            xAxisLabel: transformedData.xAxisLabel,
            yAxisLabel: transformedData.yAxisLabel,
          });
          setChartData(transformedData);
          
          // Calculate bucket interval info
          const { intervalOpenSearchValue, intervalOpenSearchUnit } = transformedData.ordered;
          setBucketInterval({
            scaled: false,
            description: `${intervalOpenSearchValue}${intervalOpenSearchUnit}`,
            scale: 1,
          });
        } else {
          // Check if this is due to empty results (valid case) vs actual error
          const hasEmptyResults = resp?.datarows?.length === 0 && resp?.schema && Array.isArray(resp.schema);
          if (hasEmptyResults) {
            console.log('[PplAlertingHistogramWrapper] Query returned empty results - no data in the specified time range');
          } else {
            console.warn('[PplAlertingHistogramWrapper] Failed to transform response to chart data:', {
              hasSchema: !!resp?.schema,
              hasDatarows: Array.isArray(resp?.datarows),
              datarowsCount: resp?.datarows?.length,
              schema: resp?.schema,
            });
          }
          setChartData(undefined);
        }
      } catch (error) {
        console.error('Error executing PPL query:', {
          error,
          errorMessage: error?.message,
          errorStack: error?.stack,
          query: queryText,
        });
        setChartData(undefined);
      } finally {
        setIsLoading(false);
      }
    },
    [httpClient, dataSourceId, timeField, interval]
  );

  // Calculate time range from look back window
  const calculateTimeRangeFromLookBack = useCallback(() => {
    if (!useLookBackWindow || !timeField) {
      return null;
    }

    const amount = Number(lookBackAmount ?? 1);
    const unit = String(lookBackUnit || 'hours').toLowerCase();
    
    // Calculate minutes from look back window
    let minutes = 0;
    if (unit.startsWith('minute')) {
      minutes = Math.floor(amount);
    } else if (unit.startsWith('hour')) {
      minutes = Math.floor(amount * 60);
    } else if (unit.startsWith('day')) {
      minutes = Math.floor(amount * 60 * 24);
    } else {
      minutes = Math.floor(amount);
    }

    // Create time range string (e.g., 'now-15m' to 'now')
    const timeRange = {
      from: `now-${minutes}m`,
      to: 'now',
    };

    return timeRange;
  }, [useLookBackWindow, lookBackAmount, lookBackUnit]);

  // Initial query execution and re-execution on interval change
  useEffect(() => {
    if (query && query.trim() && timeField) {
      const timeRange = calculateTimeRangeFromLookBack();
      if (timeRange) {
        executeQuery(query, timeRange);
      }
    }
  }, [query, interval, executeQuery, timeField, calculateTimeRangeFromLookBack]);

  const handleExecuteQuery = useCallback(
    async (queryText: string, timeRange: { from: string; to: string }) => {
      await executeQuery(queryText, timeRange);
    },
    [executeQuery]
  );

  // Handle interval change from chart component
  const handleIntervalChange = useCallback((newInterval: string) => {
    setInterval(newInterval);
  }, []);

  // Don't show graph if no query, no timeField, or look back window is disabled
  if (!query || !query.trim() || !timeField || !useLookBackWindow) {
    return null;
  }

  return (
    <AlertingHistogramChart
      bucketInterval={bucketInterval}
      chartData={chartData}
      config={config}
      data={data}
      services={services}
      showHistogram={showHistogram}
      query={query}
      onExecuteQuery={handleExecuteQuery}
      onChartDataUpdate={setChartData}
      initialInterval={interval}
      onIntervalChange={handleIntervalChange}
      useLookBackWindow={useLookBackWindow}
      lookBackAmount={lookBackAmount}
      lookBackUnit={lookBackUnit}
    />
  );
};

