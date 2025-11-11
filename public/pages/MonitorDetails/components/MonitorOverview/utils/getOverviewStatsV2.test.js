/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import getOverviewStatsV2 from './getOverviewStatsV2';
import { DEFAULT_EMPTY_DATA } from '../../../../../utils/constants';

describe('getOverviewStatsV2', () => {
  test('returns minimal overview stats for PPL monitors', () => {
    const monitor = {
      description: 'Example description',
      last_update_time: '2024-01-01T00:00:00Z',
      schedule: {
        period: { interval: 5, unit: 'MINUTES' },
      },
    };
    const monitorId = 'monitor-123';
    const activeCount = 3;

    const stats = getOverviewStatsV2(monitor, monitorId, activeCount);

    expect(stats).toHaveLength(5);
    expect(stats[0]).toEqual({ header: 'Total active alerts', value: activeCount });
    expect(stats[1].header).toBe('Schedule');
    expect(stats[2].header).toBe('Last updated');
    expect(stats[3]).toEqual({ header: 'Monitor ID', value: monitorId });
    expect(stats[4]).toEqual({ header: 'Description', value: 'Example description' });
  });

  test('handles missing fields gracefully', () => {
    const stats = getOverviewStatsV2({}, 'id-1');
    expect(stats[4]).toEqual({ header: 'Description', value: DEFAULT_EMPTY_DATA });
  });
});
