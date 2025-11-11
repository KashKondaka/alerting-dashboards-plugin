/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { EuiButtonGroup } from '@elastic/eui';
import DashboardClassic from './DashboardClassic';
import DashboardPpl from './DashboardPpl';
import { isPplAlertingEnabled } from '../../../services';

const DASHBOARD_VIEW_MODE_STORAGE_KEY = 'alerting_dashboard_view_mode';

const DashboardRouter = (props) => {
  const { initialViewMode = 'new', perAlertView } = props;
  const pplEnabled = isPplAlertingEnabled();

  const computeInitialView = () => {
    console.log('[DashboardRouter] computeInitialView', {
      pplEnabled,
      initialViewMode,
      stored:
        typeof window !== 'undefined'
          ? window.localStorage?.getItem(DASHBOARD_VIEW_MODE_STORAGE_KEY)
          : undefined,
    });
    if (!pplEnabled) {
      return 'classic';
    }

    if (initialViewMode === 'classic' || initialViewMode === 'new') {
      return initialViewMode;
    }

    try {
      const stored = localStorage.getItem(DASHBOARD_VIEW_MODE_STORAGE_KEY);
      if (stored === 'classic' || stored === 'new') {
        return stored;
      }
    } catch (e) {
      // ignore storage errors
      console.log('[DashboardRouter] error reading stored viewMode', e);
    }

    return 'new';
  };

  const [viewMode, setViewMode] = useState(computeInitialView);
  console.log('[DashboardRouter] init', { viewMode, pplEnabled, perAlertView });

  useEffect(() => {
    if (!pplEnabled && viewMode !== 'classic') {
      setViewMode('classic');
      console.log('[DashboardRouter] forcing classic because ppl disabled');
    }
  }, [pplEnabled, viewMode]);

  useEffect(() => {
    if (pplEnabled) {
      try {
        localStorage.setItem(DASHBOARD_VIEW_MODE_STORAGE_KEY, viewMode);
      } catch (e) {
        // ignore storage errors
        console.log('[DashboardRouter] error writing viewMode to storage', e);
      }
    }
    console.log('[DashboardRouter] viewMode effect', { viewMode, pplEnabled });
  }, [viewMode, pplEnabled]);

  const options = useMemo(
    () =>
      pplEnabled
        ? [
            { id: 'new', label: 'New' },
            { id: 'classic', label: 'Classic' },
          ]
        : [{ id: 'classic', label: 'Classic' }],
    [pplEnabled]
  );

  const handleViewModeChange = (id) => {
    console.log('[DashboardRouter] handleViewModeChange', { id });
    setViewMode(id);
  };

  const showToggle = pplEnabled && !perAlertView;

  const ViewComponent = viewMode === 'classic' ? DashboardClassic : DashboardPpl;
  console.log('[DashboardRouter] rendering', { viewMode, showToggle, perAlertView });

  return (
    <ViewComponent
      {...props}
      initialViewMode={viewMode}
      viewMode={viewMode}
      toggleOptions={options}
      showToggle={showToggle}
      onViewModeChange={handleViewModeChange}
    />
  );
};

export default DashboardRouter;
