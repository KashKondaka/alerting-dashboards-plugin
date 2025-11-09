/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useEffect } from 'react';
import {
  AnnotationDomainType,
  Axis,
  Chart,
  HistogramBarSeries,
  LineAnnotation,
  Position,
  ScaleType,
  Settings,
  TooltipType,
} from '@elastic/charts';
import { EuiFlexGroup, EuiFlexItem, EuiText } from '@elastic/eui';
import moment from 'moment-timezone';
import { euiThemeVars } from '@osd/ui-shared-deps/theme';
import './PplAlertingVisualGraph.scss';

interface PplAlertingVisualGraphProps {
  response: any;
  thresholdValue?: number;
  values: any;
  services: any;
  onMaxYValueCalculated?: (maxY: number) => void;
}

interface ChartValue {
  x: number;
  y: number;
}

const extractBuckets = (response: any): any[] => {
  if (!response || !response.aggregations) return [];
  return (
    response.aggregations.ppl_histogram?.buckets ||
    response.aggregations.count_over_time?.buckets ||
    response.aggregations.date_histogram?.buckets ||
    response.aggregations.combined_value?.buckets ||
    []
  );
};

const parseBucketTimestamp = (bucket: any): number | null => {
  const candidate =
    bucket.key_as_string ??
    bucket.keyAsString ??
    bucket.key ??
    bucket.span ??
    bucket.window ??
    bucket.bucket;

  if (candidate instanceof Date) return candidate.getTime();
  if (typeof candidate === 'number') return candidate;

  const parsed = new Date(String(candidate));
  const time = parsed.getTime();
  return Number.isFinite(time) ? time : null;
};

const parseBucketCount = (bucket: any): number => {
  const count =
    bucket.doc_count ??
    bucket.count ??
    bucket['count()'] ??
    bucket.total ??
    bucket.value ??
    0;
  const numeric = Number(count);
  return Number.isFinite(numeric) ? numeric : 0;
};

const buildChartData = (response: any): ChartValue[] => {
  const buckets = extractBuckets(response);
  if (!Array.isArray(buckets) || buckets.length === 0) return [];

  return buckets
    .map((bucket: any) => {
      const x = parseBucketTimestamp(bucket);
      const y = parseBucketCount(bucket);
      if (x != null && Number.isFinite(y) && x > 0) {
        return { x, y };
      }
      return null;
    })
    .filter(Boolean)
    .sort((a: any, b: any) => a.x - b.x);
};

const computeYAxis = (data: ChartValue[], thresholdValue?: number) => {
  const yValues = data.map((d) => d.y).filter((v) => Number.isFinite(v));
  const dataMax = yValues.length ? Math.max(...yValues, 0) : 0;
  const thresholdNumeric =
    typeof thresholdValue === 'number' && thresholdValue > 0 ? thresholdValue : 0;
  let yMax = Math.max(dataMax, thresholdNumeric);
  const padding = Math.max(1, Math.ceil(yMax * 0.1));
  yMax = Math.max(yMax + padding, 1);
  return { yDomain: { min: 0, max: yMax }, dataMax };
};

const computeXAxis = (data: ChartValue[]) => {
  const xValues = data.map((d) => d.x).filter((x) => Number.isFinite(x));
  if (!xValues.length) return null;
  return { min: Math.min(...xValues), max: Math.max(...xValues) };
};

const formatXTick = (value: number | string) => {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return '';
  return moment(numeric).format('HH:mm:ss');
};

const formatYTick = (value: number) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '\u00A0';
  return value.toLocaleString();
};

const buildTickValues = (max?: number) => {
  if (!max || max <= 0) return [];
  const steps = 4;
  const step = max / steps;
  return Array.from({ length: steps }, (_, idx) => Math.round((idx + 1) * step));
};

export const PplAlertingVisualGraph: React.FC<PplAlertingVisualGraphProps> = ({
  response,
  thresholdValue,
  onMaxYValueCalculated,
}) => {
  const data = useMemo(() => buildChartData(response), [response]);
  const xDomain = useMemo(() => computeXAxis(data), [data]);
  const { yDomain, dataMax } = useMemo(
    () => computeYAxis(data, thresholdValue),
    [data, thresholdValue]
  );
  const yTickValues = useMemo(() => buildTickValues(yDomain?.max), [yDomain?.max]);

  useEffect(() => {
    if (onMaxYValueCalculated && dataMax > 0) {
      onMaxYValueCalculated(Math.ceil(dataMax));
    }
  }, [dataMax, onMaxYValueCalculated]);

  if (!data.length) {
    return (
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '160px' }}
      >
        <EuiText>No valid data points found.</EuiText>
      </div>
    );
  }

  if (!xDomain || !Number.isFinite(xDomain.min) || !Number.isFinite(xDomain.max)) {
    return (
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '160px' }}
      >
        <EuiText>No valid time data found.</EuiText>
      </div>
    );
  }

  const chartsTheme = {
    background: { color: 'transparent' },
  };

  const hasThreshold =
    typeof thresholdValue === 'number' && Number.isFinite(thresholdValue);
  const lineAnnotationData = hasThreshold
    ? [{ dataValue: thresholdValue, details: `Threshold: ${thresholdValue.toLocaleString()}` }]
    : [];

  const lineAnnotationStyle = {
    line: {
      stroke: euiThemeVars.euiColorDanger,
      strokeWidth: 2,
      opacity: 0.8,
      dash: [5, 5],
    },
  };

  return (
  <EuiFlexGroup
      direction="column"
      gutterSize="none"
      className="alertingChart__wrapper alertingChart__wrapper--enhancement"
      data-test-subj="alertingChartWrapper"
    >
      <EuiFlexItem grow={false}>
        <EuiText size="s" style={{ padding: '10px' }}>
          <strong>Results</strong>
        </EuiText>
      </EuiFlexItem>
      <EuiFlexItem grow={false}>
        <section
          aria-label="Histogram of found documents"
          className="alertingTimechart"
          data-test-subj="alertingTimechart"
        >
          <div className="alertingHistogram" data-test-subj="alertingChart" style={{ height: '160px' }}>
            <Chart size="100%">
              <Settings
                xDomain={xDomain}
                tooltip={{
                  type: TooltipType.VerticalCursor,
                }}
                theme={chartsTheme}
              />
              <Axis
                id="alerting-histogram-left-axis"
                position={Position.Left}
                title="Count"
                ticks={yTickValues.length || 5}
                tickFormat={formatYTick}
                domain={yDomain}
                tickValues={yTickValues}
              />
              <Axis
                id="alerting-histogram-bottom-axis"
                position={Position.Bottom}
                title="Time"
                ticks={10}
                tickFormat={formatXTick}
              />
              {hasThreshold && lineAnnotationData.length > 0 && (
                <LineAnnotation
                  id="threshold-line"
                  domainType={AnnotationDomainType.YDomain}
                  dataValues={lineAnnotationData}
                  hideTooltips={false}
                  style={lineAnnotationStyle}
                />
              )}
              <HistogramBarSeries
                id="alerting-histogram"
                minBarHeight={2}
                xScaleType={ScaleType.Time}
                yScaleType={ScaleType.Linear}
                xAccessor="x"
                yAccessors={['y']}
                data={data}
                name="Count"
              />
            </Chart>
          </div>
        </section>
      </EuiFlexItem>
    </EuiFlexGroup>
  );
};

export default PplAlertingVisualGraph;

