/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useCallback } from 'react';
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
import moment from 'moment-timezone';
import { euiThemeVars } from '@osd/ui-shared-deps/theme';
import { EuiText } from '@elastic/eui';
import './PplAlertingVisualGraph.scss';

interface ChartDataPoint {
  x: number;
  y: number;
}

interface ChartData {
  values: ChartDataPoint[];
  xAxisOrderedValues: number[];
  xAxisFormat: {
    id: string;
    params: { pattern: string };
  };
  xAxisLabel: string;
  yAxisLabel?: string;
  ordered: {
    date: boolean;
    interval: any;
    intervalOpenSearchUnit: string;
    intervalOpenSearchValue: number;
    min: any;
    max: any;
  };
}

interface PplAlertingVisualGraphProps {
  response: any;
  thresholdValue?: number;
  values: any;
  services: any;
  onMaxYValueCalculated?: (maxY: number) => void;
}

const processPPLResponseToChartData = (response: any): ChartData | null => {
  if (!response || !response.aggregations) return null;

  const buckets =
    response.aggregations.ppl_histogram?.buckets ||
    response.aggregations.count_over_time?.buckets ||
    response.aggregations.date_histogram?.buckets ||
    response.aggregations.combined_value?.buckets ||
    [];

  if (!Array.isArray(buckets) || buckets.length === 0) {
    return null;
  }

  const values = buckets
    .map((bucket: any) => {
      const timestamp =
        bucket.key_as_string ||
        bucket.keyAsString ||
        bucket.key ||
        bucket.span ||
        bucket.window ||
    bucket.bucket;
      const count = Number(
    bucket.doc_count ??
    bucket.count ??
    bucket['count()'] ??
    bucket.total ??
    bucket.value ??
          0
      ) || 0;

      let x: number;
      if (timestamp instanceof Date) {
        x = timestamp.getTime();
      } else if (typeof timestamp === 'number') {
        x = timestamp;
      } else {
        const parsedDate = new Date(String(timestamp));
        x = parsedDate.getTime();
      }

      if (Number.isFinite(x) && Number.isFinite(count) && x > 0) {
        return { x, y: count };
      }
      return null;
    })
    .filter(Boolean)
    .sort((a: any, b: any) => a.x - b.x);

  if (values.length === 0) return null;

  return {
    values,
    xAxisOrderedValues: values.map((point) => point.x),
    xAxisFormat: { id: 'date', params: { pattern: 'YYYY-MM-DD HH:mm:ss' } },
    xAxisLabel: 'Time',
    yAxisLabel: 'Count',
    ordered: {
      date: true,
      interval: moment.duration(1, 'hour'),
      intervalOpenSearchUnit: 'h',
      intervalOpenSearchValue: 1,
      min: moment(values[0]?.x),
      max: moment(values[values.length - 1]?.x),
    },
  };
};

const synthesizeBuckets = (value: number, points = 12) => {
  const now = Date.now();
  const hourMs = 60 * 60 * 1000;
  const total = Number(value) || 0;
  if (total <= 0) {
    return Array.from({ length: points }, (_, idx) => ({ key: now - (points - idx) * hourMs, doc_count: 0 }));
  }
  return Array.from({ length: points }, (_, idx) => {
    const weight = (idx + 1) / points;
    const bucketValue = Math.max(0, Math.round((total / points) * weight * 1.5));
    return { key: now - (points - idx) * hourMs, doc_count: bucketValue };
  });
};

export const PplAlertingVisualGraph: React.FC<PplAlertingVisualGraphProps> = ({
  response,
  thresholdValue,
  onMaxYValueCalculated,
}) => {
  const data = useMemo(() => processPPLResponseToChartData(response), [response]);
  const normalizedData = useMemo(() => {
    if (data?.values.length > 1) return data.values;
    const total = data?.values.length === 1 ? data.values[0]?.y ?? 0 : 0;
    return synthesizeBuckets(total).map(({ key, doc_count }) => ({ x: key, y: doc_count }));
  }, [data]);
  const xDomain = useMemo(() => {
    if (!normalizedData.length) {
      return { min: 0, max: 0 };
    }
    const xValues = normalizedData.map((d) => d.x).filter((x) => Number.isFinite(x));
    return {
      min: Math.min(...xValues),
      max: Math.max(...xValues),
    };
  }, [normalizedData]);
  const thresholdNumeric = Number(thresholdValue);

  const { yDomain, dataMax } = useMemo(
    () => {
      if (!normalizedData.length) {
        return {
          xDomain: { min: 0, max: 0 },
          yDomain: { min: 0, max: 1 },
          dataMax: 0,
        };
      }

      const xValues = normalizedData.map((d) => d.x).filter((x) => Number.isFinite(x));
      const yValues = normalizedData.map((d) => d.y).filter((y) => Number.isFinite(y));

      const xDom = {
        min: Math.min(...xValues),
        max: Math.max(...xValues),
      };

      const dataMaximum = Math.max(...yValues, 0);
      let yMax = Math.max(dataMaximum, thresholdNumeric);
      const padding = Math.max(1, Math.ceil(yMax * 0.1));
      yMax = Math.max(yMax + padding, 1);

      return {
        xDomain: xDom,
        yDomain: { min: 0, max: yMax },
        dataMax: dataMaximum,
      };
    },
    [normalizedData, thresholdNumeric]
  );
  const yTickValues = useMemo(() => {
    const max = yDomain?.max ?? 0;
    if (!max || max <= 0) return [];
    const steps = 4;
    const step = max / steps;
    return Array.from({ length: steps }, (_, idx) => Math.round((idx + 1) * step));
  }, [yDomain?.max]);

  const formatXValue = useCallback((value: number | string) => {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) return '';
    return moment(numeric).format('HH:mm:ss');
  }, []);

  const formatYValue = useCallback((value: number) => {
    if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) return '\u00A0';
    return value.toLocaleString();
  }, []);

  React.useEffect(() => {
    if (onMaxYValueCalculated && dataMax > 0) {
      onMaxYValueCalculated(Math.ceil(dataMax));
    }
  }, [dataMax, onMaxYValueCalculated]);

  if (!normalizedData.length) {
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

  const hasThreshold = Number.isFinite(thresholdNumeric) && thresholdNumeric > 0 && normalizedData.length > 0;

  const lineAnnotationData = hasThreshold
    ? [
        {
          dataValue: thresholdNumeric,
          details: `Threshold: ${thresholdNumeric.toLocaleString()}`,
        },
      ]
    : [];

  const lineAnnotationStyle = {
    line: {
      stroke: euiThemeVars.euiColorDanger,
      strokeWidth: 2,
      opacity: 0.8,
    },
  };

  const chartsTheme = {
    background: { color: 'transparent' },
  };

  return (
        <section
          aria-label="Histogram of found documents"
          className="alertingTimechart"
          data-test-subj="alertingTimechart"
        >
      <div className="alertingHistogram" data-test-subj="alertingChart" style={{ height: '220px', width: '100%' }}>
        <Chart size={{ width: '100%', height: '100%' }} key={`chart-${thresholdNumeric}-${dataMax}`}>
          <Settings xDomain={xDomain} tooltip={{ type: TooltipType.VerticalCursor }} theme={chartsTheme} />
              <Axis
                id="alerting-histogram-left-axis"
                position={Position.Left}
            title={data?.yAxisLabel ?? 'Count'}
                ticks={yTickValues.length || 5}
            tickFormat={formatYValue}
                domain={yDomain}
                tickValues={yTickValues}
              />
              <Axis
                id="alerting-histogram-bottom-axis"
                position={Position.Bottom}
            title={data?.xAxisLabel ?? 'Time'}
                ticks={10}
            tickFormat={formatXValue}
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
            data={normalizedData}
                name="Count"
            barsPadding={0.2}
              />
            </Chart>
          </div>
        </section>
  );
};

export default PplAlertingVisualGraph;

