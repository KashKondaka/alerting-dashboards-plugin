/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import DashboardClassic from './DashboardClassic';
import DashboardRouter from './DashboardRouter';
import { isPplAlertingEnabled } from '../../../services';

const Dashboard = (props) => {
  console.log('[Dashboard] render', {
    pplEnabled: isPplAlertingEnabled(),
    initialViewMode: props?.initialViewMode,
    viewModeProp: props?.viewMode,
    monitorIds: props?.monitorIds,
    perAlertView: props?.perAlertView,
  });
  if (!isPplAlertingEnabled()) {
    console.log('[Dashboard] routing to DashboardClassic');
    return <DashboardClassic {...props} />;
  }

  console.log('[Dashboard] routing to DashboardRouter');
  return <DashboardRouter {...props} />;
};

export default Dashboard;
