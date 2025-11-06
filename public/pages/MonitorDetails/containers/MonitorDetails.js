/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Component } from 'react';
import MonitorDetailsV1 from './MonitorDetailsV1';
import MonitorDetailsV2 from './MonitorDetailsV2';

/**
 * Router component that decides whether to show v1 or v2 MonitorDetails
 * based on the viewMode (classic vs new) stored in localStorage
 */
export default class MonitorDetails extends Component {
  getViewMode = () => {
    // Check URL params first
    const searchParams = new URLSearchParams(this.props.location.search);
    const urlViewMode = searchParams.get('viewMode');
    if (urlViewMode === 'classic' || urlViewMode === 'new') {
      return urlViewMode;
    }

    // Fall back to localStorage
    try {
      const stored = localStorage.getItem('alerting_monitors_view_mode');
      if (stored === 'classic' || stored === 'new') {
        return stored;
      }
    } catch (e) {
      console.error('Error reading viewMode from localStorage:', e);
    }

    // Default to 'new' mode
    return 'new';
  };

  render() {
    const viewMode = this.getViewMode();
    
    // Route to the appropriate MonitorDetails version
    if (viewMode === 'classic') {
      return <MonitorDetailsV1 {...this.props} />;
    } else {
      return <MonitorDetailsV2 {...this.props} />;
    }
  }
}

