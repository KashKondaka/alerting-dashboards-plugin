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
  EuiToolTip,
  EuiSmallButtonIcon,
  EuiFlexItem,
  EuiPagination,
  EuiFlexGroup,
} from '@elastic/eui';
import ContentPanel from '../../../components/ContentPanel';
import DashboardEmptyPrompt from '../components/DashboardEmptyPrompt';
import DashboardControls from '../components/DashboardControls';
import { alertColumns, queryColumns } from '../utils/tableUtils';
import {
  ALERT_STATE,
  MONITOR_TYPE,
  OPENSEARCH_DASHBOARDS_AD_PLUGIN,
} from '../../../utils/constants';
import { backendErrorNotification } from '../../../utils/helpers';
import {
  getInitialSize,
  getQueryObjectFromState,
  getURLQueryParams,
  groupAlertsByTrigger,
  insertGroupByColumn,
} from '../utils/helpers';
import { DEFAULT_PAGE_SIZE_OPTIONS } from '../../Monitors/containers/Monitors/utils/constants';
import { MAX_ALERT_COUNT } from '../utils/constants';
import { getAlertsFindingColumn } from '../components/FindingsDashboard/findingsUtils';
import { ChainedAlertDetailsFlyout } from '../components/ChainedAlertDetailsFlyout/ChainedAlertDetailsFlyout';
import { CLUSTER_METRICS_CROSS_CLUSTER_ALERT_TABLE_COLUMN } from '../../CreateMonitor/components/ClusterMetricsMonitor/utils/clusterMetricsMonitorConstants';
import {
  getDataSourceQueryObj,
  isDataSourceChanged,
  getDataSourceId,
  appendCommentsAction,
  getIsCommentsEnabled,
  getIsAgentConfigured,
} from '../../utils/helpers';
import { getUseUpdatedUx } from '../../../services';

export default class Dashboard extends Component {
  constructor(props) {
    super(props);

    const { location, perAlertView } = props;

    const { alertState, from, search, severityLevel, size, sortDirection, sortField } =
      getURLQueryParams(location);

    this.dataSourceQuery = getDataSourceQueryObj();
    this.state = {
      alerts: [],
      alertsByTriggers: [],
      alertState,
      flyoutIsOpen: false,
      loadingMonitors: true,
      monitors: [],           // normalized: each hit._source === monitor object
      monitorsById: {},       // { [monitorId]: monitorObject }
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
      //chainedAlert: undefined,
      commentsEnabled: false,
      isAgentConfigured: false,
    };
  }

  static defaultProps = {
    monitorIds: [],
    detectorIds: [],
  };

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
      httpClient.get('../api/alerting/v2/monitors/alerts').then((resp) => {
        if (resp.ok) {
          const payload = resp.resp || resp;
          let rawAlerts = [];
          let totalFromServer;

          // 1) v2: { alertV2s: [...], totalAlertV2s: N }
          if (Array.isArray(payload?.alertV2s)) {
            rawAlerts = payload.alertV2s.map((a) => ({
              ...a,
              monitor_id: a.monitor_v2_id,
              // v2 provides monitor_version; keep a stable "version" key for itemId
              version: a.monitor_v2_version ?? a.version,
              monitorVersion: a.monitor_v2_version,
              // Map v2 fields to expected column fields
              start_time: a.triggered_time,
              trigger_name: a.trigger_v2_name,
              end_time: a.expiration_time,
              // v2 may not include a state; default to ACTIVE so filters/selection work
              state: a.state || 'ACTIVE',
            }));
            totalFromServer = payload.totalAlertV2s ?? rawAlerts.length;
          } else {
            // 2) Other shapes we’ve handled previously (monitors[], payload[], or {monitor_id, alerts})
            const bundles = Array.isArray(payload?.monitors)
              ? payload.monitors
              : Array.isArray(payload)
              ? payload
              : payload?.monitor_id && Array.isArray(payload?.alerts)
              ? [payload]
              : Array.isArray(payload?.alerts)
              ? [{ monitor_id: undefined, version: undefined, alerts: payload.alerts }]
              : [];
            rawAlerts = bundles.flatMap((b) =>
              (b.alerts || []).map((a) => ({
                ...a,
                monitor_id: a.monitor_id ?? b.monitor_id,
                version: a.version ?? b.version,
              }))
            );
            totalFromServer =
              payload.total_alerts ?? payload.totalAlerts ?? rawAlerts.length;
          }

          // Filter by monitor IDs if specified
          if (Array.isArray(monitorIds) && monitorIds.length) {
            rawAlerts = rawAlerts.filter((alert) => 
              monitorIds.includes(alert.monitor_id)
            );
          }

          // ---- Client-side filter/search/sort/paginate ----
          const q = String(search || '').trim().toLowerCase();
          const matchesSearch = (a) =>
            !q || JSON.stringify(a).toLowerCase().includes(q);
          const matchesSeverity =
            !severityLevel || severityLevel === 'ALL'
              ? () => true
              : (a) =>
                  String(a.severity).toLowerCase() === String(severityLevel).toLowerCase() ||
                  Number(a.severity) === Number(severityLevel);
          const matchesState =
            !alertState || alertState === 'ALL'
              ? () => true
              : (a) => String(a.state).toLowerCase() === String(alertState).toLowerCase();

          let filtered = rawAlerts.filter(
            (a) => matchesSearch(a) && matchesSeverity(a) && matchesState(a)
          );

          const dir = sortDirection === 'asc' ? 1 : -1;
          // If v2 data is used and UI asks for "start_time", prefer "triggered_time"
          const sortFieldEffective =
            Array.isArray(payload?.alertV2s) && sortField === 'start_time'
              ? 'triggered_time'
              : sortField;
          const val = (obj) => _.get(obj, sortFieldEffective);
          filtered = filtered.sort((a, b) => {
            const av = val(a);
            const bv = val(b);
            if (av == null && bv == null) return 0;
            if (av == null) return -dir;
            if (bv == null) return dir;
            if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
            // try date
            const ad = Date.parse(av);
            const bd = Date.parse(bv);
            if (Number.isFinite(ad) && Number.isFinite(bd)) return (ad - bd) * dir;
            return String(av).localeCompare(String(bv)) * dir;
          });

          const totalAlerts = totalFromServer ?? filtered.length;
          const paged = filtered.slice(from, from + size);

          this.setState({ alerts: perAlertView ? paged : filtered, totalAlerts });

          if (!perAlertView) {
            const alertsByTriggers = groupAlertsByTrigger(filtered).map((row) => {
              const latest = _.maxBy(row.alerts || [], (a) =>
                (a && (a.triggered_time ?? a.start_time)) || 0
              );
              const ts = latest?.triggered_time ?? latest?.start_time ?? null; // v2 first, fallback if needed
              return { ...row, lastTriggeredTime: ts };
            });
            this.setState(
              {
                totalTriggers: alertsByTriggers.length,
                alertsByTriggers,
              },
              () => this.getMonitors() // fetch monitor docs after grouping
            );
          }
        } else {
          console.log('error getting alerts:', resp);
          backendErrorNotification(notifications, 'get', 'alerts', resp.err);
        }
      });
    },
    500,
    { leading: true }
  );

  async getMonitors() {
    const { httpClient } = this.props;
    const { alertsByTriggers } = this.state;
    this.setState({ loadingMonitors: true });

    const monitorIds = Array.from(
      new Set(alertsByTriggers.map((a) => a.monitor_id).filter(Boolean))
    );

    if (!monitorIds.length) {
      this.setState({ loadingMonitors: false, monitors: [], monitorsById: {} });
      return;
    }

    try {
      // Query v2 monitor docs by ID
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

      // Normalize hits so each hit._source is the monitor object itself
      // (v2 returns { _source: { monitor: {...} } })
      const normalizedHits = _.get(response, 'resp.hits.hits', []).map((hit) => {
        const monitorObj = hit._source?.monitor ? hit._source.monitor : hit._source || {};
        return { ...hit, _source: monitorObj };
      });

      // Build lookup map: { id -> monitorObject }
      const monitorsById = normalizedHits.reduce((acc, h) => {
        acc[h._id] = h._source || {};
        return acc;
      }, {});

      // Optionally enrich existing grouped rows with monitor_name for immediate rendering
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

  // TODO: exists in both Dashboard and Monitors, should be moved to redux when implemented
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
          openChainedAlertsFlyout: this.openChainedAlertsFlyout,
          closeFlyout: this.closeFlyout,
        },
      });
    }
  };

  // openChainedAlertsFlyout = (chainedAlert) => {
  //   this.setState({ chainedAlert });
  // };

  // closeChainedAlertsFlyout = () => {
  //   this.setState({ chainedAlert: undefined });
  // };

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
    this.setState({ ...this.state, showAlertsModal: true });
  };

  closeModal = () => {
    this.setState({ ...this.state, search: '', showAlertsModal: false });
    this.refreshDashboard();
  };

  renderModal = () => {
    const { history, httpClient, location, notifications } = this.props;
    const { monitors, selectedItems } = this.state;
    const { monitor_id, triggerID, trigger_name } = selectedItems[0];

    // After normalization, hit._source is the monitor object itself
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
      //chainedAlert,
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
    let totalItems = perAlertView ? totalAlerts : totalTriggers;
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
        case MONITOR_TYPE.COMPOSITE_LEVEL:
          columns = _.cloneDeep(queryColumns);
//           -          columns.push({
// -            name: 'Actions',
// -            sortable: false,
// -            actions: [
// -              {
// -                render: (alert) => (
// -                  <EuiToolTip content={'View details'}>
// -                    <EuiSmallButtonIcon
// -                      aria-label={'View details'}
// -                      data-test-subj={`view-details-icon`}
// -                      iconType={'inspect'}
// -                      onClick={() => {
// -                        this.openChainedAlertsFlyout(alert);
// -                      }}
// -                    />
// -                  </EuiToolTip>
// -                ),
// -              },
// -            ],
// -          });
          break;
        default:
          columns = _.cloneDeep(queryColumns);
          break;
      }

      if (commentsEnabled) {
        columns = appendCommentsAction(columns, httpClient);
      }
    } else {
      // alertColumns consumes `monitors` to show monitor **names**.
      // We pass the normalized list so names resolve for v2 docs.
      columns = alertColumns(
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
        this.refreshDashboard
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

    const selection = {
      onSelectionChange: this.onSelectionChange,
      selectable: () => false, // Disable selection since acknowledge is removed
    };

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

    const useUpdatedUx = !perAlertView && getUseUpdatedUx();
    const shouldShowPagination = !perAlertView && totalAlerts > 0;

    return (
      <>
        {/* {chainedAlert && (
          <ChainedAlertDetailsFlyout
            httpClient={httpClient}
            closeFlyout={this.closeChainedAlertsFlyout}
            alert={chainedAlert}
          />
        )} */}
        <ContentPanel
          title={perAlertView ? 'Alerts' : useUpdatedUx ? undefined : 'Alerts by triggers'}
          titleSize={'s'}
          bodyStyles={{ padding: 'initial' }}
          actions={useUpdatedUx ? undefined : actions()}
          panelOptions={{ hideTitleBorder: useUpdatedUx }}
          panelStyles={{ padding: useUpdatedUx && totalAlerts < 1 ? '16px 16px 0px' : '16px' }}
        >
          <DashboardControls
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
            panelStyles={{ padding: perAlertView ? '8px 0px 16px' : '0px 0px 16px' }}
          />

          <EuiBasicTable
            items={perAlertView ? alerts : alertsByTriggers}
            itemId={getItemId}
            columns={columns}
            pagination={perAlertView ? pagination : undefined}
            sorting={sorting}
            isSelectable={true}
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

          {shouldShowPagination && (
            <EuiFlexGroup justifyContent="flexEnd" style={{ padding: '8px 0px 0px' }}>
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
