/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import './AlertingHistogramChart.scss';

import React, { useCallback, useMemo, useState, useEffect } from 'react';
import moment from 'moment';
import dateMath from '@elastic/datemath';
import {
  EuiButtonIcon,
  EuiFlexGroup,
  EuiFlexItem,
  EuiToolTip,
  EuiSuperDatePicker,
  EuiSuperUpdateButton,
  EuiButton,
} from '@elastic/eui';
import { i18n } from '@osd/i18n';
import { IUiSettingsClient } from 'opensearch-dashboards/public';
import { DataPublicPluginStart, search } from '../../../../../../../src/plugins/data/public';
import { TimechartHeader, TimechartHeaderBucketInterval } from './TimechartHeader';
import { DiscoverHistogram } from './histogram/Histogram';
import { Chart } from './utils/ChartTypes';

interface AlertingHistogramChartProps {
  bucketInterval?: TimechartHeaderBucketInterval;
  chartData?: Chart;
  config: IUiSettingsClient;
  data: DataPublicPluginStart;
  services: any;
  showHistogram: boolean;
  query: string;
  onExecuteQuery: (query: string, timeRange: { from: string; to: string }) => Promise<any>;
  onChartDataUpdate?: (chartData: Chart | undefined) => void;
  initialInterval?: string;
  onIntervalChange?: (interval: string) => void;
  // Look back window props for time range calculation
  useLookBackWindow?: boolean;
  lookBackAmount?: number;
  lookBackUnit?: string;
}

export const AlertingHistogramChart = ({
  bucketInterval,
  chartData,
  config,
  data,
  services,
  showHistogram,
  query,
  onExecuteQuery,
  onChartDataUpdate,
  initialInterval = 'auto',
  onIntervalChange,
  useLookBackWindow = true,
  lookBackAmount = 1,
  lookBackUnit = 'hours',
}: AlertingHistogramChartProps) => {
  // Calculate time range from look back window instead of timefilter
  const calculateTimeRangeFromLookBack = useCallback(() => {
    if (!useLookBackWindow) {
      return { from: '', to: '' };
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

    // Create time range strings
    const now = moment();
    const fromMoment = moment().subtract(minutes, 'minutes');
    
    return {
      from: fromMoment.format('YYYY-MM-DDTHH:mm:ss.SSSZ'),
      to: now.format('YYYY-MM-DDTHH:mm:ss.SSSZ'),
    };
  }, [useLookBackWindow, lookBackAmount, lookBackUnit]);

  const [timeRange, setTimeRange] = useState(() => calculateTimeRangeFromLookBack());

  const [isLoading, setIsLoading] = useState(false);
  const [currentChartData, setCurrentChartData] = useState<Chart | undefined>(chartData);
  const [currentInterval, setCurrentInterval] = useState(initialInterval);

  // Update time range when look back window changes (no longer using timefilter)
  useEffect(() => {
    const newTimeRange = calculateTimeRangeFromLookBack();
    setTimeRange(newTimeRange);
  }, [calculateTimeRangeFromLookBack]);

  // Update chart data when prop changes
  useEffect(() => {
    setCurrentChartData(chartData);
    if (onChartDataUpdate) {
      onChartDataUpdate(chartData);
    }
  }, [chartData, onChartDataUpdate]);

  const onChangeInterval = useCallback(
    async (newInterval: string) => {
      setCurrentInterval(newInterval);
      // Notify parent component of interval change
      if (onIntervalChange) {
        onIntervalChange(newInterval);
      }
      // Interval change will trigger query re-execution through the wrapper component
      // which watches the interval state and uses look back window for time range
      if (query && useLookBackWindow) {
        const amount = Number(lookBackAmount ?? 1);
        const unit = String(lookBackUnit || 'hours').toLowerCase();
        
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

        const timeRangeForQuery = {
          from: `now-${minutes}m`,
          to: 'now',
        };

        setIsLoading(true);
        try {
          await onExecuteQuery(query, timeRangeForQuery);
        } catch (error) {
          console.error('Error executing query:', error);
        } finally {
          setIsLoading(false);
        }
      }
    },
    [query, onExecuteQuery, onIntervalChange, useLookBackWindow, lookBackAmount, lookBackUnit]
  );

  // Timefilter update handler - disabled since we're using look back window
  const timefilterUpdateHandler = useCallback(
    async (ranges: { from: number; to: number }) => {
      // No-op: We don't allow manual time range changes when using look back window
      // The time range is calculated from look back window settings
    },
    []
  );

  const handleRefresh = useCallback(async () => {
    if (query) {
      // Recalculate time range from look back window for refresh
      const refreshedTimeRange = calculateTimeRangeFromLookBack();
      const amount = Number(lookBackAmount ?? 1);
      const unit = String(lookBackUnit || 'hours').toLowerCase();
      
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

      const timeRangeForQuery = {
        from: `now-${minutes}m`,
        to: 'now',
      };

      setIsLoading(true);
      try {
        await onExecuteQuery(query, timeRangeForQuery);
      } catch (error) {
        console.error('Error executing query:', error);
      } finally {
        setIsLoading(false);
      }
    }
  }, [query, onExecuteQuery, calculateTimeRangeFromLookBack, lookBackAmount, lookBackUnit]);

  // Safely get date format with fallback
  const dateFormat = useMemo(() => {
    if (!config || typeof config.get !== 'function') {
      return 'MMM D, YYYY @ HH:mm:ss.SSS';
    }
    try {
      return config.get('dateFormat') || 'MMM D, YYYY @ HH:mm:ss.SSS';
    } catch (e) {
      console.warn('Error getting dateFormat from config:', e);
      return 'MMM D, YYYY @ HH:mm:ss.SSS';
    }
  }, [config]);

  const timeChartHeader = (
    <div className="alertingChart__TimechartHeader" data-test-subj="alertingChartTimechartHeader">
      <TimechartHeader
        title={i18n.translate('alerting.discover.timechartHeader.logCount', {
          defaultMessage: 'Log count',
        })}
        bucketInterval={bucketInterval}
        dateFormat={dateFormat}
        timeRange={timeRange}
        options={search?.aggs?.intervalOptions || []}
        onChangeInterval={onChangeInterval}
        stateInterval={currentInterval || ''}
      />
    </div>
  );

  const toggleLabel = i18n.translate('alerting.discover.histogram.collapse', {
    defaultMessage: 'Toggle histogram',
  });

  const toggle = (
    <EuiToolTip content={toggleLabel}>
      <EuiButtonIcon
        aria-expanded={showHistogram}
        aria-label={toggleLabel}
        data-test-subj="histogramCollapseBtn"
        iconType={showHistogram ? 'arrowDown' : 'arrowRight'}
        iconSize="m"
        color="text"
      />
    </EuiToolTip>
  );

  // Get commonly used ranges from UI settings with error handling
  const commonlyUsedRanges = useMemo(() => {
    if (!config || typeof config.get !== 'function') {
      return [];
    }
    try {
      const ranges = config.get('timepicker:quickRanges', []);
      if (Array.isArray(ranges)) {
        return ranges.map(({ from, to, display }: { from: string; to: string; display: string }) => ({
          start: from,
          end: to,
          label: display,
        }));
      }
      return [];
    } catch (e) {
      // timepicker:quickRanges may not be available or may be invalid JSON
      console.warn('Error getting timepicker quick ranges:', e);
      return [];
    }
  }, [config]);

  // Date picker removed - using look back window instead
  const datePicker = null;

  const refreshButton = (
    <EuiButton
      iconType="refresh"
      onClick={handleRefresh}
      isLoading={isLoading}
      data-test-subj="alertingRefreshButton"
      size="s"
    >
      {i18n.translate('alerting.discover.refreshButton', {
        defaultMessage: 'Refresh',
      })}
    </EuiButton>
  );

  const queryEnhancedHistogramHeader = (
    <EuiFlexGroup
      direction="row"
      gutterSize="m"
      className="alertingChart__chartheader"
      data-test-subj="alertingChartChartheader"
      alignItems="center"
    >
      <EuiFlexItem grow={false}>{toggle}</EuiFlexItem>
      <EuiFlexItem grow={true} style={{ justifyContent: 'flex-start' }}>
        {timeChartHeader}
      </EuiFlexItem>
      {/* Date picker removed - using look back window instead */}
      <EuiFlexItem grow={false}>{refreshButton}</EuiFlexItem>
    </EuiFlexGroup>
  );

  const displayHistogram = chartData && showHistogram;

  return (
    <EuiFlexGroup
      direction="column"
      gutterSize="none"
      className="alertingChart__wrapper alertingChart__wrapper--enhancement"
      data-test-subj="alertingChartWrapper"
    >
      {queryEnhancedHistogramHeader}
      {displayHistogram && (
        <EuiFlexItem grow={false}>
          <section
            aria-label={i18n.translate('alerting.discover.histogramOfFoundDocumentsAriaLabel', {
              defaultMessage: 'Histogram of found documents',
            })}
            className="alertingTimechart"
            data-test-subj="alertingTimechart"
          >
            <div className="alertingHistogram" data-test-subj="alertingChart">
              <DiscoverHistogram
                chartData={currentChartData!}
                chartType={'HistogramBar'}
                timefilterUpdateHandler={timefilterUpdateHandler}
                services={services}
              />
            </div>
          </section>
        </EuiFlexItem>
      )}
    </EuiFlexGroup>
  );
};

