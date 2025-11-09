/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Component } from 'react';
import MonitorDetailsV1 from './MonitorDetailsV1';
import MonitorDetailsV2 from './MonitorDetailsV2';
import { MONITOR_ACTIONS } from '../../../utils/constants';
import { getDataSourceQueryObj } from '../../utils/helpers';
import { isPplAlertingEnabled } from '../../../services';

/**
 * Router component that decides whether to show v1 or v2 MonitorDetails
 * based on the stored view mode and monitor type (for edit flow)
 */
export default class MonitorDetailsRouter extends Component {
  state = {
    resolvedViewMode: undefined,
  };

  componentDidMount() {
    this._isMounted = true;
    this.resolveViewMode();
  }

  componentDidUpdate(prevProps) {
    const locationChanged =
      prevProps.location?.search !== this.props.location?.search ||
      prevProps.match?.params?.monitorId !== this.props.match?.params?.monitorId;
    if (locationChanged) {
      this.resolveViewMode();
    }
  }

  componentWillUnmount() {
    this._isMounted = false;
  }

  getBaseViewMode = () => {
    const searchParams = new URLSearchParams(this.props.location.search);
    const urlViewMode = searchParams.get('viewMode');
    if (urlViewMode === 'classic' || urlViewMode === 'new') {
      return urlViewMode;
    }

    try {
      const stored = localStorage.getItem('alerting_monitors_view_mode');
      if (stored === 'classic' || stored === 'new') {
        return stored;
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Error reading viewMode from localStorage:', e);
    }

    return 'new';
  };

  isPplMonitor = (monitor) => {
    if (!monitor) return false;
    if (monitor.monitor_v2 || monitor.ppl_monitor) return true;
    const queryLanguage = monitor.query_language || monitor.queryLanguage;
    if (typeof queryLanguage === 'string' && queryLanguage.toLowerCase() === 'ppl') {
      return true;
    }
    return false;
  };

  resolveViewMode = async () => {
    const baseViewMode = this.getBaseViewMode();
    const searchParams = new URLSearchParams(this.props.location.search);
    const isEditAction = searchParams.get('action') === MONITOR_ACTIONS.EDIT_MONITOR;
    const pplEnabled = isPplAlertingEnabled();

    if (!isEditAction) {
      if (this._isMounted) {
        this.setState({ resolvedViewMode: pplEnabled ? baseViewMode : 'classic' });
      }
      return;
    }

    let resolvedViewMode = baseViewMode;
    try {
      const dataSourceQuery = getDataSourceQueryObj();
      const monitorId = this.props.match?.params?.monitorId;
      if (monitorId) {
        const resp = await this.props.httpClient.get(
          `../api/alerting/monitors/${encodeURIComponent(monitorId)}`,
          dataSourceQuery
        );
        const monitor = resp?.resp;
        if (monitor) {
          resolvedViewMode = this.isPplMonitor(monitor) ? 'new' : 'classic';
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('MonitorDetails: unable to determine monitor type for edit view', err);
      resolvedViewMode = baseViewMode;
    }

    if (!pplEnabled) {
      resolvedViewMode = 'classic';
    }

    if (this._isMounted) {
      this.setState({ resolvedViewMode });
    }
  };

  render() {
    const searchParams = new URLSearchParams(this.props.location.search);
    const isEditAction = searchParams.get('action') === MONITOR_ACTIONS.EDIT_MONITOR;
    const viewMode =
      this.state.resolvedViewMode !== undefined
        ? this.state.resolvedViewMode
        : isEditAction
        ? undefined
        : this.getBaseViewMode();

    if (viewMode === undefined) {
      return null;
    }

    const pplEnabled = isPplAlertingEnabled();
    if (viewMode === 'classic' || !pplEnabled) {
      return <MonitorDetailsV1 {...this.props} />;
    }

    return <MonitorDetailsV2 {...this.props} />;
  }
}
