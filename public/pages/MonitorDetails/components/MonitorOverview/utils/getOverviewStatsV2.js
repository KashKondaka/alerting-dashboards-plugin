/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { EuiLink } from '@elastic/eui';
import moment from 'moment-timezone';
import getScheduleFromPplMonitor from './getScheduleFromPplMonitor';
import {
  DEFAULT_EMPTY_DATA,
  OPENSEARCH_DASHBOARDS_AD_PLUGIN,
} from '../../../../../utils/constants';

const getTime = (time) => {
  const momentTime = moment.tz(time, moment.tz.guess());
  if (time && momentTime.isValid()) return momentTime.format('MM/DD/YY h:mm a z');
  return DEFAULT_EMPTY_DATA;
};

export default function getOverviewStatsV2(
  monitor,
  monitorId,
  _monitorVersion,
  activeCount,
  detector,
  detectorId,
  _localClusterName,
  _setFlyout
) {
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

  return [
    ...detectorOverview,
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
      header: 'Description',
      value: monitor.description || DEFAULT_EMPTY_DATA,
    },
  ];
}
