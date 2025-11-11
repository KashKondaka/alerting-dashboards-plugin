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
import { isPplMonitor as isPplMonitorUtil } from '../../../utils/pplHelpers';

/**
 * Router component that decides whether to show v1 or v2 MonitorDetails
 * based on the stored view mode and monitor type (for edit flow)
 */
export default class MonitorDetailsRouter extends Component {
  state = {
    resolvedViewMode: undefined,
  };

  componentDidMount() {
    this.instrumentHttpClient();
    // Debug: initial mount
    console.log('[MonitorDetailsRouter] componentDidMount', this.props.match?.params?.monitorId, {
      locationSearch: this.props.location?.search,
    });
    this._isMounted = true;
    this.resolveViewMode();
  }

  componentDidUpdate(prevProps) {
    const locationChanged =
      prevProps.location?.search !== this.props.location?.search ||
      prevProps.match?.params?.monitorId !== this.props.match?.params?.monitorId;
    if (prevProps.httpClient !== this.props.httpClient) {
      this.instrumentHttpClient();
    }
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
      console.log('[MonitorDetailsRouter] unable to read viewMode from localStorage', e);
      // eslint-disable-next-line no-console
      console.error('Error reading viewMode from localStorage:', e);
    }

    return 'new';
  };

  instrumentHttpClient = () => {
    const { httpClient } = this.props;
    if (!httpClient || httpClient.__alertingDebugWrapped) {
      return;
    }

    const wrap = (methodName) => {
      const original = httpClient[methodName].bind(httpClient);
      httpClient[methodName] = async (...args) => {
        const [path, options] = args;
        if (typeof path === 'string' && path.includes('../api/alerting')) {
          // Capture stack for tracing unexpected callers
          const stackTop =
            new Error().stack
              ?.split('\n')
              .slice(1, 8)
              .map((line) => line.trim()) || [];
          console.log(
            `[AlertingHttpDebug] ${methodName.toUpperCase()} ${path}\n  stack:\n    ${stackTop.join(
              '\n    '
            )}`,
            options || {}
          );
        }
        return original(...args);
      };
    };

    wrap('get');
    wrap('post');
    wrap('put');
    wrap('delete');

    Object.defineProperty(httpClient, '__alertingDebugWrapped', {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  };

  resolveViewMode = async () => {
    const baseViewMode = this.getBaseViewMode();
    const searchParams = new URLSearchParams(this.props.location.search);
    const isEditAction = searchParams.get('action') === MONITOR_ACTIONS.EDIT_MONITOR;
    const pplEnabled = isPplAlertingEnabled();
    console.log('[MonitorDetailsRouter] resolveViewMode:start', {
      baseViewMode,
      isEditAction,
      pplEnabled,
      monitorId: this.props.match?.params?.monitorId,
    });

    if (!isEditAction) {
      if (this._isMounted) {
        this.setState({ resolvedViewMode: pplEnabled ? baseViewMode : 'classic' });
      }
      console.log('[MonitorDetailsRouter] resolveViewMode:nonEdit', {
        resolved: pplEnabled ? baseViewMode : 'classic',
      });
      return;
    }

    let resolvedViewMode = baseViewMode;
    try {
      const dataSourceQuery = getDataSourceQueryObj();
      const monitorId = this.props.match?.params?.monitorId;
      if (monitorId) {
        let monitor = null;
        const shouldStayOnV2 = pplEnabled && baseViewMode === 'new';

        if (pplEnabled) {
          console.log('[MonitorDetailsRouter] attempt fetch v2 monitor', {
            monitorId,
            dataSourceQuery,
          });
          try {
            const pplResp = await this.props.httpClient.get(
              `../api/alerting/v2/monitors/${encodeURIComponent(monitorId)}`,
              dataSourceQuery
            );
            monitor = pplResp?.resp ?? null;
            console.log('[MonitorDetailsRouter] v2 monitor fetch complete', {
              ok: pplResp?.ok,
              hasMonitor: Boolean(monitor),
            });
          } catch (e) {
            console.log('[MonitorDetailsRouter] v2 monitor fetch error', e);
            // stay silent; fallback handled below if needed
          }
        }

        if (!monitor && !shouldStayOnV2) {
          console.log('[MonitorDetailsRouter] fallback fetch v1 monitor', {
            monitorId,
            dataSourceQuery,
          });
          try {
            const legacyResp = await this.props.httpClient.get(
              `../api/alerting/monitors/${encodeURIComponent(monitorId)}`,
              dataSourceQuery
            );
            monitor = legacyResp?.resp ?? null;
            console.log('[MonitorDetailsRouter] v1 monitor fetch complete', {
              ok: legacyResp?.ok,
              hasMonitor: Boolean(monitor),
            });
          } catch (e) {
            // legacy endpoint may not exist; swallow and use base view mode
            console.log('[MonitorDetailsRouter] v1 monitor fetch error', e);
          }
        }

        if (monitor) {
          resolvedViewMode = isPplMonitorUtil(monitor) ? 'new' : 'classic';
          console.log('[MonitorDetailsRouter] monitor type resolved', {
            resolvedViewMode,
          });
        } else if (shouldStayOnV2) {
          resolvedViewMode = 'new';
          console.log('[MonitorDetailsRouter] defaulting to v2 viewMode due to base selection');
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
      console.log('[MonitorDetailsRouter] resolveViewMode:final', { resolvedViewMode });
      this.setState({ resolvedViewMode });
    }
  };

  render() {
    const searchParams = new URLSearchParams(this.props.location.search);
    const isEditAction = searchParams.get('action') === MONITOR_ACTIONS.EDIT_MONITOR;
    const pplEnabled = isPplAlertingEnabled();
    const { resolvedViewMode } = this.state;

    if (pplEnabled && resolvedViewMode === undefined) {
      return null;
    }

    console.log('[MonitorDetailsRouter] render', {
      resolvedViewMode,
      baseViewMode: this.getBaseViewMode(),
      pplEnabled,
    });
    const viewMode =
      resolvedViewMode !== undefined
        ? resolvedViewMode
        : isEditAction
        ? undefined
        : this.getBaseViewMode();

    if (viewMode === undefined) {
      return null;
    }

    if (viewMode === 'classic' || !pplEnabled) {
      console.log('[MonitorDetailsRouter] rendering MonitorDetailsV1', { viewMode, pplEnabled });
      return <MonitorDetailsV1 {...this.props} viewMode="classic" />;
    }

    console.log('[MonitorDetailsRouter] rendering MonitorDetailsV2', { viewMode, pplEnabled });
    return <MonitorDetailsV2 {...this.props} viewMode="new" />;
  }
}
