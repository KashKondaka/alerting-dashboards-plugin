/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Component } from 'react';
import _ from 'lodash';
import queryString from 'query-string';
import {
  EuiBasicTable,
  EuiSmallButton,
  EuiIcon,
  EuiFlexItem,
  EuiPagination,
  EuiFlexGroup,
  EuiButtonGroup,
  EuiSpacer,
  EuiTitle,
} from '@elastic/eui';
import ContentPanel from '../../../components/ContentPanel';
import DashboardEmptyPrompt from '../components/DashboardEmptyPrompt';
import { DashboardControlsPpl } from '../components/DashboardControls';
import { alertColumnsPpl, queryColumns } from '../utils/tableUtilsPpl';
import {
  ALERT_STATE,
  MONITOR_TYPE,
  OPENSEARCH_DASHBOARDS_AD_PLUGIN,
} from '../../../utils/constants';
import { acknowledgeAlerts, backendErrorNotification } from '../../../utils/helpers';
import {
  getInitialSize,
  getQueryObjectFromState,
  getURLQueryParams,
  groupAlertsByTrigger,
  insertGroupByColumn,
} from '../utils/helpersPpl';
import { DEFAULT_PAGE_SIZE_OPTIONS } from '../../Monitors/containers/Monitors/utils/constants';
import { MAX_ALERT_COUNT } from '../utils/constants';
import { normalizePPLSeverity } from '../utils/pplSeverityUtils';
import AcknowledgeAlertsModal from '../components/AcknowledgeAlertsModal';
import { getAlertsFindingColumn } from '../components/FindingsDashboard/findingsUtils';
import { CLUSTER_METRICS_CROSS_CLUSTER_ALERT_TABLE_COLUMN } from '../../CreateMonitor/components/ClusterMetricsMonitor/utils/clusterMetricsMonitorConstants';
import {
  getDataSourceQueryObj,
  isDataSourceChanged,
  getDataSourceId,
  appendCommentsAction,
  getIsCommentsEnabled,
  getIsAgentConfigured,
} from '../../utils/helpers';
import { getUseUpdatedUx, isPplAlertingEnabled } from '../../../services';

const DASHBOARD_VIEW_MODE_STORAGE_KEY = 'alerting_dashboard_view_mode';

export default class DashboardPpl extends Component {
  constructor(props) {
    super(props);

    const { location, perAlertView, initialViewMode } = props;
    const { alertState, from, search, severityLevel, size, sortDirection, sortField } =
      getURLQueryParams(location);

    const pplEnabled = isPplAlertingEnabled();
    let resolvedViewMode = initialViewMode || 'new';
    if (pplEnabled) {
      if (!initialViewMode) {
        try {
          const stored = localStorage.getItem(DASHBOARD_VIEW_MODE_STORAGE_KEY);
          if (stored === 'classic' || stored === 'new') {
            resolvedViewMode = stored;
          }
        } catch (e) {
          // ignore storage errors
        }
      }
    } else {
      resolvedViewMode = 'classic';
      try {
        localStorage.setItem(DASHBOARD_VIEW_MODE_STORAGE_KEY, 'classic');
      } catch (e) {
        // ignore storage errors
      }
    }

    this.dataSourceQuery = getDataSourceQueryObj();
    this.state = {
      alerts: [],
      alertsByTriggers: [],
      alertState,
      flyoutIsOpen: false,
      loadingMonitors: true,
      monitors: [],
      monitorsById: {},
      monitorIds: this.props.monitorIds,
      page: Math.floor(from / size),
      search,
      selectedItems: [],
      severityLevel,
      showAlertsModal: false,
      size: getInitialSize(perAlertView, size),
      sortDirection,
      sortField,
      totalAlerts: 0,
      totalTriggers: 0,
      commentsEnabled: false,
      isAgentConfigured: false,
      viewMode: resolvedViewMode,
      pplEnabled,
    };
  }

  static defaultProps = {
    monitorIds: [],
    detectorIds: [],
    initialViewMode: 'new',
    onTotalsChange: undefined,
  };
  notifyTotalsChange(totalAlerts) {
    if (typeof this.props.onTotalsChange === 'function') {
      const numeric =
        typeof totalAlerts === 'number'
          ? totalAlerts
          : Number.isFinite(Number(totalAlerts))
          ? Number(totalAlerts)
          : NaN;
      const normalizedTotal = Number.isFinite(numeric) ? numeric : 0;
      this.props.onTotalsChange({ totalAlerts: normalizedTotal });
    }
  }

  componentDidMount() {
    const { alertState, page, search, severityLevel, size, sortDirection, sortField, monitorIds } =
      this.state;
    this.getAlerts(
      page * size,
      size,
      search,
      sortField,
      sortDirection,
      severityLevel,
      alertState,
      monitorIds
    );
    getIsCommentsEnabled(this.props.httpClient).then((commentsEnabled) => {
      this.setState({ commentsEnabled });
    });
    this.getUpdatedAgentConfig();
  }

  componentDidUpdate(prevProps, prevState) {
    const prevQuery = getQueryObjectFromState(prevState);
    const currQuery = getQueryObjectFromState(this.state);
    if (!_.isEqual(prevQuery, currQuery)) {
      this.getUpdatedAgentConfig();
      this.getUpdatedAlerts();
    }
    if (isDataSourceChanged(prevProps, this.props)) {
      this.dataSourceQuery = getDataSourceQueryObj();
      this.getUpdatedAgentConfig();
      this.getUpdatedAlerts();
    }

    if (prevState.viewMode !== this.state.viewMode) {
      if (this.state.pplEnabled) {
        try {
          localStorage.setItem(DASHBOARD_VIEW_MODE_STORAGE_KEY, this.state.viewMode || 'new');
        } catch (e) {
          // ignore storage errors
        }
      }
      this.getUpdatedAlerts();
    }
  }

  getUpdatedAgentConfig() {
    const dataSourceId = getDataSourceId();
    getIsAgentConfigured(dataSourceId).then((isAgentConfigured) => {
      this.setState({ isAgentConfigured });
    });
  }

  getUpdatedAlerts() {
    const { page, size, search, sortField, sortDirection, severityLevel, alertState, monitorIds } =
      this.state;
    this.getAlerts(
      page * size,
      size,
      search,
      sortField,
      sortDirection,
      severityLevel,
      alertState,
      monitorIds
    );
  }

  getAlerts = _.debounce(
    (from, size, search, sortField, sortDirection, severityLevel, alertState, monitorIds) => {
      const dataSourceId = getDataSourceId();
      const params = {
        from,
        size,
        search,
        sortField,
        sortDirection,
        severityLevel,
        alertState,
        monitorIds,
        monitorType: this.props.monitorType,
        dataSourceId,
      };

      const queryParamsString = queryString.stringify(params);
      const { httpClient, history, notifications, perAlertView } = this.props;
      history.replace({ ...this.props.location, search: queryParamsString });

      const { viewMode, pplEnabled } = this.state;
      const usePplEndpoints = pplEnabled && viewMode !== 'classic';
      const apiPath = usePplEndpoints ? '/api/alerting/v2/monitors/alerts' : '/api/alerting/alerts';
      const apiQuery = { ...params };
      if (usePplEndpoints) {
        delete apiQuery.monitorType;
        delete apiQuery.severityLevel;
        delete apiQuery.alertState;
        delete apiQuery.search;
      }
      const apiParams = { query: apiQuery };

      httpClient.get(apiPath, apiParams).then((resp) => {
        if (!resp.ok) {
          console.log('error getting alerts:', resp);
          backendErrorNotification(notifications, 'get', 'alerts', resp.err);
          return;
        }

        if (!usePplEndpoints) {
          const { alerts, totalAlerts } = resp;
          this.setState({ alerts, totalAlerts });
          this.notifyTotalsChange(totalAlerts);

          if (!perAlertView) {
            const alertsByTriggers = groupAlertsByTrigger(alerts, false);
            this.setState(
              {
                totalTriggers: alertsByTriggers.length,
                alertsByTriggers,
              },
              () => this.getMonitors()
            );
          }
          return;
        }

        const payload = resp.resp || resp;
        let rawAlerts = [];
        let totalFromServer;

        const alertsArray = payload?.alerts_v2 || payload?.alertV2s;
        if (Array.isArray(alertsArray)) {
          rawAlerts = alertsArray.map((a) => ({
            ...a,
            monitor_id: a.monitor_v2_id,
            monitor_name: a.monitor_v2_name,
            trigger_id: a.trigger_v2_id,
            version: a.monitor_v2_version ?? a.version,
            monitorVersion: a.monitor_v2_version,
            start_time: a.triggered_time,
            trigger_name: a.trigger_v2_name,
            end_time: a.expiration_time,
            state: a.state || 'ACTIVE',
          }));
          totalFromServer = payload.total_alerts_v2 ?? payload.totalAlertV2s ?? rawAlerts.length;
        }

        if (Array.isArray(monitorIds) && monitorIds.length) {
          rawAlerts = rawAlerts.filter((alert) => monitorIds.includes(alert.monitor_id));
        }

        const q = String(search || '')
          .trim()
          .toLowerCase();
        const matchesSearch = (a) => {
          if (!q) return true;
          const triggerName = a.trigger_name || a.trigger_v2_name || a.triggerName || '';
          const normalizedTrigger = String(triggerName).trim().toLowerCase();
          return normalizedTrigger.startsWith(q);
        };

        const normalizedSeverityFilter =
          severityLevel && severityLevel !== 'ALL'
            ? normalizePPLSeverity(severityLevel)
            : undefined;

        const matchesSeverity = normalizedSeverityFilter
          ? (a) => {
              const rawSeverity = a.severity ?? a.severity_level ?? a.alertSeverity;
              const normalized = normalizePPLSeverity(rawSeverity);
              return normalized === normalizedSeverityFilter;
            }
          : () => true;

        const normalizedStateFilter =
          alertState && alertState !== 'ALL' ? String(alertState).toLowerCase() : undefined;

        const matchesState = normalizedStateFilter
          ? (a) => {
              const rawState = a.state ?? a.alert_state ?? a.alertState;
              if (rawState === undefined || rawState === null) return false;
              return String(rawState).toLowerCase() === normalizedStateFilter;
            }
          : () => true;

        let filtered = rawAlerts.filter(
          (a) => matchesSearch(a) && matchesSeverity(a) && matchesState(a)
        );

        const dir = sortDirection === 'asc' ? 1 : -1;
        const sortFieldEffective = sortField === 'start_time' ? 'triggered_time' : sortField;
        const val = (obj) => _.get(obj, sortFieldEffective);
        filtered = filtered.sort((a, b) => {
          const av = val(a);
          const bv = val(b);
          if (av == null && bv == null) return 0;
          if (av == null) return -dir;
          if (bv == null) return dir;
          if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
          const ad = Date.parse(av);
          const bd = Date.parse(bv);
          if (Number.isFinite(ad) && Number.isFinite(bd)) return (ad - bd) * dir;
          return String(av).localeCompare(String(bv)) * dir;
        });

        const totalAlerts = totalFromServer ?? filtered.length;
        const paged = filtered.slice(from, from + size);

        this.setState({ alerts: perAlertView ? paged : filtered, totalAlerts });
        this.notifyTotalsChange(totalAlerts);

        if (!perAlertView) {
          const alertsByTriggers = groupAlertsByTrigger(filtered, true).map((row) => {
            const latest = _.maxBy(
              row.alerts || [],
              (a) => (a && (a.triggered_time ?? a.start_time)) || 0
            );
            const ts = latest?.triggered_time ?? latest?.start_time ?? null;
            return { ...row, lastTriggeredTime: ts };
          });
          this.setState(
            {
              totalTriggers: alertsByTriggers.length,
              alertsByTriggers,
            },
            () => this.getMonitors()
          );
        }
      });
    },
    500,
    { leading: true }
  );

  async getMonitors() {
    const { httpClient } = this.props;
    const { alertsByTriggers, viewMode, pplEnabled } = this.state;
    this.setState({ loadingMonitors: true });

    const monitorIds = Array.from(
      new Set(alertsByTriggers.map((a) => a.monitor_id).filter(Boolean))
    );

    if (!monitorIds.length) {
      this.setState({ loadingMonitors: false, monitors: [], monitorsById: {} });
      return;
    }

    try {
      const usePplEndpoints = pplEnabled && viewMode !== 'classic';

      if (!usePplEndpoints) {
        const query = {
          monitorIds: monitorIds.join(','),
          size: monitorIds.length || 1000,
          from: 0,
          ...(this.dataSourceQuery?.query || {}),
        };
        const response = await httpClient.get('../api/alerting/monitors', { query });

        if (!response.ok) {
          console.log('error getting monitors:', response);
          this.setState({ loadingMonitors: false });
          return;
        }

        const normalizedHits = (response.monitors || []).map((mon) => ({
          _id: mon.id,
          _version: mon.version,
          _seq_no: mon.ifSeqNo,
          _primary_term: mon.ifPrimaryTerm,
          _source: mon.monitor || {},
        }));

        const monitorsById = normalizedHits.reduce((acc, h) => {
          acc[h._id] = h._source || {};
          return acc;
        }, {});

        const enrichedAlertsByTriggers = this.state.alertsByTriggers.map((row) => ({
          ...row,
          monitor_name: monitorsById[row.monitor_id]?.name || row.monitor_id,
        }));

        this.setState({
          loadingMonitors: false,
          monitors: normalizedHits,
          monitorsById,
          alertsByTriggers: enrichedAlertsByTriggers,
        });
        return;
      }

      const body = {
        query: { ids: { values: monitorIds } },
        version: true,
        seq_no_primary_term: true,
        size: monitorIds.length || 1000,
      };

      const response = await httpClient.post('../api/alerting/v2/monitors/_search', {
        body: JSON.stringify(body),
        query: this.dataSourceQuery?.query,
      });

      if (!response.ok) {
        console.log('error getting monitors:', response);
        this.setState({ loadingMonitors: false });
        return;
      }

      const normalizedHits = _.get(response, 'resp.hits.hits', []).map((hit) => {
        const monitorObj = hit._source?.monitor ? hit._source.monitor : hit._source || {};
        return { ...hit, _source: monitorObj };
      });

      const monitorsById = normalizedHits.reduce((acc, h) => {
        acc[h._id] = h._source || {};
        return acc;
      }, {});

      const enrichedAlertsByTriggers = this.state.alertsByTriggers.map((row) => ({
        ...row,
        monitor_name: monitorsById[row.monitor_id]?.name || row.monitor_id,
      }));

      this.setState({
        loadingMonitors: false,
        monitors: normalizedHits,
        monitorsById,
        alertsByTriggers: enrichedAlertsByTriggers,
      });
    } catch (err) {
      console.error(err);
      this.setState({ loadingMonitors: false });
    }
  }

  acknowledgeAlerts = async (alerts) => {
    const { httpClient, notifications } = this.props;
    await Promise.all(acknowledgeAlerts(httpClient, notifications, alerts));
  };

  acknowledgeAlert = async () => {
    const { selectedItems } = this.state;
    const { perAlertView } = this.props;

    if (!selectedItems.length) return;

    let selectedAlerts = perAlertView ? selectedItems : _.get(selectedItems, '0.alerts', []);
    await this.acknowledgeAlerts(selectedAlerts);

    this.setState({ selectedItems: [] });
    const { page, size, search, sortField, sortDirection, severityLevel, alertState, monitorIds } =
      this.state;
    this.getAlerts(
      page * size,
      size,
      search,
      sortField,
      sortDirection,
      severityLevel,
      alertState,
      monitorIds
    );
    this.refreshDashboard();
  };

  onTableChange = ({ page: tablePage = {}, sort = {} }) => {
    const { index: page, size } = tablePage;
    const { field: sortField, direction: sortDirection } = sort;
    this.setState({ page, size, sortField, sortDirection });
  };

  onSeverityLevelChange = (e) => {
    this.setState({ page: 0, severityLevel: e.target.value });
  };

  onAlertStateChange = (e) => {
    this.setState({ page: 0, alertState: e.target.value });
  };

  onSelectionChange = (selectedItems) => {
    this.setState({ selectedItems });
  };

  onSearchChange = (e) => {
    this.setState({ page: 0, search: e.target.value });
  };

  onPageClick = (page) => {
    this.setState({ page });
  };

  openFlyout = (payload) => {
    this.setState({ flyoutIsOpen: true });
    if (!_.isEmpty(payload)) {
      this.props.setFlyout({
        type: 'alertsDashboard',
        payload: {
          ...payload,
          viewMode: this.state.viewMode,
          closeFlyout: this.closeFlyout,
        },
      });
    }
  };

  closeFlyout = () => {
    const { setFlyout } = this.props;
    if (typeof setFlyout === 'function') setFlyout(null);
    this.setState({ flyoutIsOpen: false });
  };

  refreshDashboard = () => {
    const { page, size, search, sortField, sortDirection, severityLevel, alertState, monitorIds } =
      this.state;
    this.getAlerts(
      page * size,
      size,
      search,
      sortField,
      sortDirection,
      severityLevel,
      alertState,
      monitorIds
    );
  };

  openModal = () => {
    this.setState({ showAlertsModal: true });
  };

  closeModal = () => {
    this.setState({ search: '', showAlertsModal: false });
    this.refreshDashboard();
  };

  renderModal = () => {
    const { history, httpClient, location, notifications } = this.props;
    const { monitors, selectedItems } = this.state;
    const { monitor_id, triggerID, trigger_name } = selectedItems[0] || {};

    const monitor = _.get(_.find(monitors, { _id: monitor_id }), '_source');

    return (
      <AcknowledgeAlertsModal
        history={history}
        httpClient={httpClient}
        location={location}
        monitor={monitor}
        monitorId={monitor_id}
        notifications={notifications}
        onClose={this.closeModal}
        triggerId={triggerID}
        triggerName={trigger_name}
        acknowledgeAlerts={this.acknowledgeAlerts}
      />
    );
  };

  render() {
    const {
      alerts,
      alertsByTriggers,
      alertState,
      flyoutIsOpen,
      loadingMonitors,
      monitors,
      page,
      search,
      selectedItems,
      severityLevel,
      size,
      sortDirection,
      sortField,
      totalAlerts,
      totalTriggers,
      commentsEnabled,
      isAgentConfigured,
      viewMode,
      pplEnabled,
    } = this.state;
    const {
      monitorIds,
      detectorIds,
      onCreateTrigger,
      perAlertView,
      monitorType,
      groupBy,
      setFlyout,
      httpClient,
      location,
      history,
      notifications,
      isAlertsFlyout = false,
    } = this.props;
    const totalItems = perAlertView ? totalAlerts : totalTriggers;
    const isBucketMonitor = monitorType === MONITOR_TYPE.BUCKET_LEVEL;

    let columns;
    if (perAlertView) {
      switch (monitorType) {
        case MONITOR_TYPE.BUCKET_LEVEL:
          columns = insertGroupByColumn(groupBy);
          break;
        case MONITOR_TYPE.CLUSTER_METRICS:
          columns = _.cloneDeep(queryColumns);
          columns.push(CLUSTER_METRICS_CROSS_CLUSTER_ALERT_TABLE_COLUMN);
          break;
        case MONITOR_TYPE.DOC_LEVEL:
          columns = _.cloneDeep(queryColumns);
          columns.splice(
            0,
            0,
            getAlertsFindingColumn(
              httpClient,
              history,
              location,
              notifications,
              flyoutIsOpen,
              this.openFlyout,
              this.closeFlyout
            )
          );
          break;
        default:
          columns = _.cloneDeep(queryColumns);
          break;
      }

      if (commentsEnabled) {
        columns = appendCommentsAction(columns, httpClient);
      }
    } else {
      columns = alertColumnsPpl(
        history,
        httpClient,
        loadingMonitors,
        location,
        monitors,
        notifications,
        isAgentConfigured,
        setFlyout,
        this.openFlyout,
        this.closeFlyout,
        this.refreshDashboard,
        viewMode
      );
    }

    const pagination = {
      pageIndex: page,
      pageSize: size,
      totalItemCount: Math.min(MAX_ALERT_COUNT, totalItems),
      pageSizeOptions: DEFAULT_PAGE_SIZE_OPTIONS,
    };

    const sorting = {
      sort: {
        direction: sortDirection,
        field: sortField,
      },
    };

    const isClassicView = viewMode === 'classic';
    const selection = isClassicView
      ? {
          onSelectionChange: this.onSelectionChange,
          selectable: perAlertView
            ? (item) => item.state === ALERT_STATE.ACTIVE
            : (item) => item.ACTIVE > 0,
          selectableMessage: perAlertView
            ? (selectable) => (selectable ? undefined : 'Only active alerts can be acknowledged.')
            : (selectable) =>
                selectable ? undefined : 'Only triggers with active alerts can be acknowledged.',
        }
      : undefined;

    const actions = () => {
      const actions = [];

      if (!perAlertView) {
        const alert = selectedItems[0];
        actions.unshift(
          <EuiSmallButton
            onClick={() => {
              this.openFlyout({
                ...alert,
                history,
                httpClient,
                loadingMonitors,
                location,
                monitors,
                notifications,
                setFlyout,
                closeFlyout: this.closeFlyout,
                refreshDashboard: this.refreshDashboard,
              });
            }}
            disabled={selectedItems.length !== 1}
          >
            View alert details
          </EuiSmallButton>
        );
      }

      if (viewMode === 'classic') {
        actions.push(
          <EuiSmallButton
            onClick={perAlertView ? this.acknowledgeAlert : this.openModal}
            disabled={perAlertView ? !selectedItems.length : selectedItems.length !== 1}
            data-test-subj={'acknowledgeAlertsButton'}
          >
            Acknowledge
          </EuiSmallButton>
        );
      }

      if (detectorIds.length) {
        actions.unshift(
          <EuiSmallButton
            href={`${OPENSEARCH_DASHBOARDS_AD_PLUGIN}#/detectors/${detectorIds[0]}`}
            target="_blank"
          >
            View detector <EuiIcon type="popout" />
          </EuiSmallButton>
        );
      }
      return actions;
    };

    const getItemId = (item) => {
      if (perAlertView) {
        const v = item.version ?? item.monitorVersion ?? '';
        return isBucketMonitor ? item.id : `${item.id}-${v}`;
      }
      return `${item.triggerID}-${item.version}`;
    };

    const useUpdatedUx = !perAlertView && pplEnabled && getUseUpdatedUx();
    const shouldShowPagination = !perAlertView && totalAlerts > 0;

    const toggleButtons = pplEnabled
      ? [
          { id: 'new', label: 'New' },
          { id: 'classic', label: 'Classic' },
        ]
      : [{ id: 'classic', label: 'Classic' }];

    return (
      <>
        <ContentPanel
          title={perAlertView ? 'Alerts' : useUpdatedUx ? undefined : 'Alerts by triggers'}
          titleSize={'s'}
          bodyStyles={{ padding: 'initial' }}
          actions={useUpdatedUx ? undefined : actions()}
          panelOptions={{ hideTitleBorder: useUpdatedUx }}
          panelStyles={{ padding: useUpdatedUx ? '0px' : '16px' }}
        >
          {useUpdatedUx && (
            <>
              <div style={{ padding: '16px 16px 0px 16px' }}>
                <EuiFlexGroup alignItems="center" justifyContent="spaceBetween" responsive={false}>
                  <EuiFlexItem grow={false}>
                    <EuiFlexGroup alignItems="center" gutterSize="m" responsive={false}>
                      <EuiFlexItem grow={false}>
                        <EuiTitle size="l">
                          <h1>Alerts by triggers</h1>
                        </EuiTitle>
                      </EuiFlexItem>
                      <EuiFlexItem grow={false}>
                        <EuiButtonGroup
                          legend="Alert view toggle"
                          options={toggleButtons}
                          idSelected={viewMode}
                          onChange={(id) => this.setState({ viewMode: id })}
                          buttonSize="compressed"
                          color="text"
                          isFullWidth={false}
                        />
                      </EuiFlexItem>
                    </EuiFlexGroup>
                  </EuiFlexItem>
                  <EuiFlexItem grow={false}>
                    <EuiFlexGroup gutterSize="s" responsive={false}>
                      {actions().map((action, idx) => (
                        <EuiFlexItem key={idx} grow={false}>
                          {action}
                        </EuiFlexItem>
                      ))}
                    </EuiFlexGroup>
                  </EuiFlexItem>
                </EuiFlexGroup>
              </div>
              <EuiSpacer size="m" />
            </>
          )}
          <DashboardControlsPpl
            activePage={page}
            pageCount={Math.ceil(totalItems / size) || 1}
            search={search}
            severity={severityLevel}
            state={alertState}
            onSearchChange={this.onSearchChange}
            onSeverityChange={this.onSeverityLevelChange}
            onStateChange={this.onAlertStateChange}
            onPageChange={this.onPageClick}
            isAlertsFlyout={isAlertsFlyout}
            monitorType={monitorType}
            alertActions={useUpdatedUx ? actions() : undefined}
            panelStyles={{ padding: perAlertView ? '8px 16px 16px' : '0px 16px 16px' }}
          />

          {this.state.showAlertsModal && this.renderModal()}

          <div style={{ padding: useUpdatedUx ? '0px 16px 16px 16px' : '0px' }}>
            <EuiBasicTable
              items={perAlertView ? alerts : alertsByTriggers}
              itemId={getItemId}
              columns={columns}
              pagination={perAlertView ? pagination : undefined}
              sorting={sorting}
              isSelectable={isClassicView}
              selection={selection}
              onChange={this.onTableChange}
              noItemsMessage={
                <DashboardEmptyPrompt
                  onCreateTrigger={onCreateTrigger}
                  landingDataSourceId={this.props.landingDataSourceId}
                />
              }
              data-test-subj={'alertsDashboard_table'}
            />
          </div>

          {shouldShowPagination && (
            <EuiFlexGroup
              justifyContent="flexEnd"
              style={{ padding: useUpdatedUx ? '8px 16px 0px 16px' : '8px 0px 0px' }}
            >
              <EuiFlexItem grow={false}>
                <EuiPagination
                  pageCount={Math.ceil(totalItems / size) || 1}
                  activePage={page}
                  onPageClick={this.onPageClick}
                />
              </EuiFlexItem>
            </EuiFlexGroup>
          )}

          {this.state.showAlertsModal && this.renderModal()}
        </ContentPanel>
      </>
    );
  }
}
