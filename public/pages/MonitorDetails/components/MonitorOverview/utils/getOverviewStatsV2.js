/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import _ from 'lodash';
import { EuiBadge, EuiLink } from '@elastic/eui';
import moment from 'moment-timezone';
import getScheduleFromPplMonitor from './getScheduleFromPplMonitor';
import {
  DEFAULT_EMPTY_DATA,
  MONITOR_TYPE,
  OPENSEARCH_DASHBOARDS_AD_PLUGIN,
} from '../../../../../utils/constants';
import { DATA_SOURCES_FLYOUT_TYPE } from '../../../../../components/Flyout/flyouts/dataSources';
import { getDataSources } from '../../../../CreateMonitor/components/CrossClusterConfigurations/utils/helpers';

const getTime = (time) => {
  const momentTime = moment.tz(time, moment.tz.guess());
  if (time && momentTime.isValid()) return momentTime.format('MM/DD/YY h:mm a z');
  return DEFAULT_EMPTY_DATA;
};

const getMonitorLevelType = (monitorType) => {
  switch (monitorType) {
    case MONITOR_TYPE.QUERY_LEVEL:
      return 'Per query monitor';
    case MONITOR_TYPE.BUCKET_LEVEL:
      return 'Per bucket monitor';
    case MONITOR_TYPE.CLUSTER_METRICS:
      return 'Per cluster metrics monitor';
    case MONITOR_TYPE.DOC_LEVEL:
      return 'Per document monitor';
    case MONITOR_TYPE.COMPOSITE_LEVEL:
      return 'Composite monitor';
    default:
      return DEFAULT_EMPTY_DATA;
  }
};

const getDataSourcesDisplay = (
  dataSources = [],
  localClusterName = DEFAULT_EMPTY_DATA,
  monitorType,
  setFlyout
) => {
  const closeFlyout = () => {
    if (typeof setFlyout === 'function') setFlyout(null);
  };

  const openFlyout = () => {
    if (typeof setFlyout === 'function') {
      setFlyout({
        type: DATA_SOURCES_FLYOUT_TYPE,
        payload: {
          closeFlyout: closeFlyout,
          dataSources: dataSources,
          localClusterName: localClusterName,
          monitorType: monitorType,
        },
      });
    }
  };

  return dataSources.length <= 1 ? (
    dataSources[0] || localClusterName
  ) : (
    <>
      {dataSources[0]}&nbsp;
      <EuiBadge
        color={'primary'}
        onClick={openFlyout}
        onClickAriaLabel={'View all data sources'}
        data-test-subj={'dataSourcesFlyout_badge'}
      >
        View all {dataSources.length}
      </EuiBadge>
    </>
  );
};

export default function getOverviewStatsV2(
  monitor,
  monitorId,
  monitorVersion,
  activeCount,
  detector,
  detectorId,
  localClusterName,
  setFlyout
) {
  const monitorLevelType = _.get(monitor, 'monitor_type', MONITOR_TYPE.QUERY_LEVEL);
  const dataSources = getDataSources(monitor, localClusterName);
  const detectorOverview = detector
    ? [
        {
          header: 'Detector',
          value: (
            <EuiLink
              href={`${OPENSEARCH_DASHBOARDS_AD_PLUGIN}#/detectors/${detectorId}`}
              target="_blank"
            >
              {detector.name}
            </EuiLink>
          ),
        },
      ]
    : [];

  const overviewStats = [
    {
      header: 'Monitor type',
      value: getMonitorLevelType(monitorLevelType),
    },
    {
      header: 'Monitor definition type',
      value: 'Pipe Processing Language (PPL)',
    },
    ...detectorOverview,
    {
      header: 'Data source',
      value: getDataSourcesDisplay(dataSources, localClusterName, monitorLevelType, setFlyout),
    },
    {
      header: 'Total active alerts',
      value: activeCount,
    },
    {
      header: 'Schedule',
      value: getScheduleFromPplMonitor(monitor),
    },
    {
      header: 'Last updated',
      value: getTime(monitor.last_update_time),
    },
    {
      header: 'Monitor ID',
      value: monitorId,
    },
    {
      header: 'Monitor version number',
      value: monitorVersion,
    },
    {
      header: 'Description',
      value: monitor.description || DEFAULT_EMPTY_DATA,
    },
    {
      header: 'PPL query language',
      value: monitor.query_language || 'PPL',
    },
    {
      header: 'Timestamp field',
      value: monitor.timestamp_field || DEFAULT_EMPTY_DATA,
    },
  ];

  return overviewStats;
}
