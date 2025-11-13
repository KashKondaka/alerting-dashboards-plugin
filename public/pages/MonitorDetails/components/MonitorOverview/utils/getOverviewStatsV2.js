/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import moment from 'moment-timezone';
import getScheduleFromPplMonitor from './getScheduleFromPplMonitor';
import { DEFAULT_EMPTY_DATA } from '../../../../../utils/constants';
import { formatDuration } from '../../../../CreateMonitor/containers/CreateMonitor/utils/pplAlertingHelpers';

const getTime = (time) => {
  const momentTime = moment.tz(time, moment.tz.guess());
  if (time && momentTime.isValid()) return momentTime.format('MM/DD/YY h:mm a z');
  return DEFAULT_EMPTY_DATA;
};

export default function getOverviewStatsV2(monitor, monitorId, activeCount = 0) {
  // Get look back window in minutes - check multiple possible locations
  const lookBackWindowMinutes =
    monitor?.look_back_window_minutes ?? monitor?.look_back_window ?? undefined;

  return [
    {
      header: 'Total active alerts',
      value: activeCount,
    },
    {
      header: 'Schedule',
      value: getScheduleFromPplMonitor(monitor),
    },
    {
      header: 'Look back window',
      value: formatDuration(lookBackWindowMinutes),
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
