/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import _ from 'lodash';
import querystring from 'querystring';

import { MDSEnabledClientService } from './MDSEnabledClientService';
import { INDEX } from '../../utils/constants';
import { isIndexNotFoundError } from './utils/helpers';
import { DEFAULT_HEADERS, PPL_MONITOR_BASE_API } from './utils/constants';

const ALERTS_BASE_PATH = `${PPL_MONITOR_BASE_API}/alerts`;

const isNoHandlerError = (err) =>
  err &&
  (err.response?.includes?.('no handler found for uri') ||
    err.body?.error?.includes?.('no handler found for uri') ||
    err.message?.includes?.('no handler found for uri') ||
    String(err).includes('no handler found for uri'));

export default class PplAlertingMonitorService extends MDSEnabledClientService {
  constructor(osDriver, dataSourceEnabled, logger) {
    super(osDriver, dataSourceEnabled);
    this.logger = logger;
  }

  logWarn(message) {
    if (this.logger?.warn) {
      this.logger.warn(message);
    } else {
      // eslint-disable-next-line no-console
      console.warn(message);
    }
  }

  logError(message, err) {
    if (this.logger?.error) {
      this.logger.error(`${message}: ${err?.message ?? err}`);
    } else {
      // eslint-disable-next-line no-console
      console.error(message, err);
    }
  }

  buildAlertsPath(query = {}, { omitDataSourceId = false } = {}) {
    const queryCopy = { ...query };
    if (omitDataSourceId) {
      delete queryCopy.dataSourceId;
    }
    const queryString = querystring.stringify(queryCopy);
    return `${ALERTS_BASE_PATH}${queryString ? `?${queryString}` : ''}`;
  }

  normalizeAlertsQuery(query = {}) {
    const {
      from,
      size,
      sortField,
      sortDirection,
      search,
      severityLevel,
      monitorIds,
      monitorId,
      alertState,
      dataSourceId,
    } = query;

    const normalized = {};

    if (size !== undefined) {
      const parsedSize = Number(size);
      if (!Number.isNaN(parsedSize)) normalized.size = parsedSize;
    }

    if (from !== undefined) {
      const parsedFrom = Number(from);
      if (!Number.isNaN(parsedFrom)) normalized.startIndex = parsedFrom;
    }

    if (sortField) {
      const sortFieldString = String(sortField);
      const sortFieldMap = {
        start_time: 'triggered_time',
        startTime: 'triggered_time',
      };
      normalized.sortString = sortFieldMap[sortFieldString] || sortFieldString;
    }
    if (sortDirection) normalized.sortOrder = String(sortDirection).toLowerCase();
    if (search) normalized.searchString = String(search);

    if (severityLevel && String(severityLevel).toUpperCase() !== 'ALL') {
      normalized.severityLevel = String(severityLevel);
    }

    if (alertState && String(alertState).toUpperCase() !== 'ALL') {
      normalized.alertState = String(alertState);
    }

    if (dataSourceId !== undefined) {
      normalized.dataSourceId = dataSourceId;
    }

    const monitorIdValue = Array.isArray(monitorIds) ? monitorIds[0] : monitorIds ?? monitorId;
    if (monitorIdValue) normalized.monitorId = String(monitorIdValue);

    return normalized;
  }

  normalizeMonitorListQuery(query = {}) {
    const { from, size, search, sortField, sortDirection, state, dataSourceId, monitorIds } = query;
    const normalized = {};

    if (dataSourceId !== undefined) {
      normalized.dataSourceId = dataSourceId;
    }
    if (from !== undefined) {
      const parsedFrom = Number(from);
      if (!Number.isNaN(parsedFrom)) normalized.from = parsedFrom;
    }
    if (size !== undefined) {
      const parsedSize = Number(size);
      if (!Number.isNaN(parsedSize)) normalized.size = parsedSize;
    }
    if (search !== undefined) normalized.search = String(search);
    if (sortField) normalized.sortField = String(sortField);
    if (sortDirection) normalized.sortDirection = String(sortDirection);
    if (state) normalized.state = String(state);
    if (monitorIds !== undefined) normalized.monitorIds = monitorIds;
    return normalized;
  }

  async proxyPPLQuery(context, req, res) {
    try {
      const client = this.getClientBasedOnDataSource(context, req);
      const params = {
        method: 'POST',
        path: '/_plugins/_ppl',
        body: req.body,
        headers: DEFAULT_HEADERS,
      };
      const resp = await client('transport.request', params);
      return res.ok({ body: { ok: true, resp } });
    } catch (err) {
      this.logError('Alerting - PplAlertingMonitorService - proxyPPLQuery', err);
      return res.ok({ body: { ok: false, resp: err?.message ?? err } });
    }
  }

  async listIndices(context, req, res) {
    try {
      const client = this.getClientBasedOnDataSource(context, req);
      const resp = await client('transport.request', {
        method: 'GET',
        path: '/_cat/indices?format=json&h=index',
        headers: DEFAULT_HEADERS,
      });
      const body = resp?.body ?? resp;
      const rows = Array.isArray(body) ? body : [];
      const names = rows.map((row) => row.index).filter(Boolean);
      const indices = Array.from(new Set(names)).sort();
      return res.ok({ body: { ok: true, indices } });
    } catch (err) {
      this.logError('Alerting - PplAlertingMonitorService - listIndices', err);
      return res.ok({ body: { ok: false, indices: [], resp: err?.message ?? err } });
    }
  }

  async getMonitors(context, req, res) {
    try {
      const client = this.getClientBasedOnDataSource(context, req);
      const query = this.normalizeMonitorListQuery(req.query);
      const {
        from = 0,
        size = 20,
        search = '',
        sortField = 'name',
        sortDirection = 'asc',
        state = 'all',
        dataSourceId,
        monitorIds,
      } = query;

      const trimmedSearch = String(search || '').trim();
      let must = { match_all: {} };
      if (trimmedSearch) {
        const escaped = trimmedSearch.split(' ').join('* *');
        must = {
          query_string: {
            fields: [
              'monitor.name',
              'ppl_monitor.name',
              'monitor_v2.ppl_monitor.name',
              'workflow.name',
            ],
            default_operator: 'AND',
            query: `*${escaped}*`,
          },
        };
      }

      const should = [];
      const mustList = [must];

      if (monitorIds !== undefined) {
        const idsArray = Array.isArray(monitorIds)
          ? monitorIds
          : typeof monitorIds === 'string' && monitorIds.includes(',')
          ? monitorIds.split(',').map((id) => id.trim())
          : [monitorIds];
        mustList.push({ terms: { _id: idsArray.filter(Boolean) } });
      }

      if (state !== 'all') {
        const enabled = state === 'enabled';
        should.push({ term: { 'monitor.enabled': enabled } });
        should.push({ term: { 'workflow.enabled': enabled } });
      }

      const monitorSorts = { name: 'monitor.name.keyword' };
      const monitorSortPageData = { size: _.defaultTo(size, 1000) };
      if (monitorSorts[sortField]) {
        monitorSortPageData.sort = [{ [monitorSorts[sortField]]: sortDirection }];
        monitorSortPageData.size = _.defaultTo(size, 1000);
        monitorSortPageData.from = _.defaultTo(from, 0);
      }

      const searchBody = {
        seq_no_primary_term: true,
        version: true,
        ...monitorSortPageData,
        query: {
          bool: {
            should,
            minimum_should_match: state !== 'all' ? 1 : 0,
            must: mustList,
          },
        },
        aggregations: {
          associated_composite_monitors: {
            nested: { path: 'workflow.inputs.composite_input.sequence.delegates' },
            aggs: {
              monitor_ids: {
                terms: { field: 'workflow.inputs.composite_input.sequence.delegates.monitor_id' },
              },
            },
          },
        },
      };

      const getResponse = await client('transport.request', {
        method: 'POST',
        path: `${PPL_MONITOR_BASE_API}/_search`,
        body: searchBody,
        headers: DEFAULT_HEADERS,
      });

      const allHits = _.get(getResponse, 'hits.hits', []);
      const filteredHits = allHits.filter((result) => {
        const id = result._id || '';
        const monitor = result._source?.monitor || result._source || {};
        return !id.endsWith('-metadata') && !monitor.metadata;
      });

      const totalMonitors = filteredHits.length;
      const monitorKeyValueTuples = filteredHits.map((result) => {
        const {
          _id: id,
          _version: version,
          _seq_no: ifSeqNo,
          _primary_term: ifPrimaryTerm,
          _source,
        } = result;

        let monitor = _source?.monitor ? _source.monitor : _source || {};
        const pplMonitor = monitor?.monitor_v2?.ppl_monitor || monitor?.ppl_monitor;
        if (pplMonitor) {
          monitor = {
            ...monitor,
            ...pplMonitor,
            monitor_v2: monitor.monitor_v2,
          };
        }

        if (!monitor.monitor_type) {
          monitor.monitor_type = 'query_level';
        }

        const item_type = monitor.workflow_type || monitor.monitor_type || 'query_level';
        if (!Array.isArray(monitor.triggers)) monitor.triggers = [];

        const name = monitor.name || id;
        const enabled = !!monitor.enabled;

        return [id, { id, version, ifSeqNo, ifPrimaryTerm, name, enabled, item_type, monitor }];
      });

      const monitorMap = new Map(monitorKeyValueTuples);
      const associatedCompositeMonitorCountMap = {};
      _.get(
        getResponse,
        'aggregations.associated_composite_monitors.monitor_ids.buckets',
        []
      ).forEach(({ key, doc_count }) => {
        associatedCompositeMonitorCountMap[key] = doc_count;
      });
      const monitorIdsOutput = [...monitorMap.keys()];

      const aggsOrderData = {};
      const aggsSorts = {
        active: 'active',
        acknowledged: 'acknowledged',
        errors: 'errors',
        ignored: 'ignored',
        lastNotificationTime: 'last_notification_time',
      };
      if (aggsSorts[sortField]) aggsOrderData.order = { [aggsSorts[sortField]]: sortDirection };

      const aggsParams = {
        index: INDEX.ALL_ALERTS,
        body: {
          size: 0,
          query: { terms: { monitor_id: monitorIdsOutput } },
          aggregations: {
            uniq_monitor_ids: {
              terms: { field: 'monitor_id', ...aggsOrderData, size: from + size },
              aggregations: {
                active: { filter: { term: { state: 'ACTIVE' } } },
                acknowledged: { filter: { term: { state: 'ACKNOWLEDGED' } } },
                errors: { filter: { term: { state: 'ERROR' } } },
                ignored: {
                  filter: {
                    bool: {
                      filter: { term: { state: 'COMPLETED' } },
                      must_not: { exists: { field: 'acknowledged_time' } },
                    },
                  },
                },
                last_notification_time: { max: { field: 'last_notification_time' } },
                latest_alert: {
                  top_hits: {
                    size: 1,
                    sort: [{ start_time: { order: 'desc' } }],
                    _source: { includes: ['last_notification_time', 'trigger_name'] },
                  },
                },
              },
            },
          },
        },
      };

      const esAggsResponse = await client('transport.request', {
        method: 'POST',
        path: `/${INDEX.ALL_ALERTS}/_search`,
        body: aggsParams.body,
        headers: DEFAULT_HEADERS,
      });

      const buckets = _.get(esAggsResponse, 'aggregations.uniq_monitor_ids.buckets', []).map(
        (bucket) => {
          const {
            key: id,
            last_notification_time: { value: lastNotificationTime },
            ignored: { doc_count: ignored },
            acknowledged: { doc_count: acknowledged },
            active: { doc_count: active },
            errors: { doc_count: errors },
            latest_alert: {
              hits: {
                hits: [
                  {
                    _source: { trigger_name: latestAlert },
                  },
                ],
              },
            },
          } = bucket;
          const monitor = monitorMap.get(id);
          monitorMap.delete(id);
          return {
            ...monitor,
            id,
            lastNotificationTime,
            ignored,
            latestAlert,
            acknowledged,
            active,
            errors,
            currentTime: Date.now(),
            associatedCompositeMonitorCnt: associatedCompositeMonitorCountMap[id] || 0,
          };
        }
      );

      const unusedMonitors = [...monitorMap.values()].map((row) => ({
        ...row,
        lastNotificationTime: null,
        ignored: 0,
        active: 0,
        acknowledged: 0,
        errors: 0,
        latestAlert: '--',
        currentTime: Date.now(),
        associatedCompositeMonitorCnt: associatedCompositeMonitorCountMap[row.id] || 0,
      }));

      let results = _.orderBy(buckets.concat(unusedMonitors), [sortField], [sortDirection]);
      if (!monitorSorts[sortField]) results = results.slice(from, from + size);

      return res.ok({ body: { ok: true, monitors: results, totalMonitors } });
    } catch (err) {
      if (isIndexNotFoundError(err)) {
        return res.ok({
          body: {
            ok: false,
            resp: { totalMonitors: 0, monitors: [], message: 'No monitors created' },
          },
        });
      }
      this.logError('Alerting - PplAlertingMonitorService - getMonitors', err);
      return res.ok({ body: { ok: false, resp: err?.message ?? err } });
    }
  }

  async searchMonitors(context, req, res) {
    try {
      const client = this.getClientBasedOnDataSource(context, req);
      const resp = await client('transport.request', {
        method: 'POST',
        path: `${PPL_MONITOR_BASE_API}/_search`,
        body: req.body,
        headers: DEFAULT_HEADERS,
      });
      return res.ok({ body: resp });
    } catch (err) {
      this.logError('Alerting - PplAlertingMonitorService - searchMonitors', err);
      return res.ok({ body: { ok: false, resp: err?.message ?? err } });
    }
  }

  async createMonitor(context, req, res) {
    try {
      const client = this.getClientBasedOnDataSource(context, req);
      const resp = await client('transport.request', {
        method: 'POST',
        path: PPL_MONITOR_BASE_API,
        body: req.body,
        headers: DEFAULT_HEADERS,
      });
      return res.ok({ body: { ok: true, resp } });
    } catch (err) {
      this.logError('Alerting - PplAlertingMonitorService - createMonitor', err);
      return res.ok({ body: { ok: false, resp: err?.message ?? err } });
    }
  }

  async updateMonitor(context, req, res) {
    try {
      const client = this.getClientBasedOnDataSource(context, req);
      const id = req.params.id;
      const ifSeqNo = req.query?.if_seq_no ?? req.query?.ifSeqNo;
      const ifPrimaryTerm = req.query?.if_primary_term ?? req.query?.ifPrimaryTerm;

      const qs = new URLSearchParams();
      if (Number.isFinite(Number(ifSeqNo))) qs.append('if_seq_no', String(ifSeqNo));
      if (Number.isFinite(Number(ifPrimaryTerm)))
        qs.append('if_primary_term', String(ifPrimaryTerm));

      let cleanedBody = req.body;
      if (req.body?.ppl_monitor) {
        const {
          enabled_time,
          schema_version,
          last_update_time,
          user,
          id: monitorId,
          last_update_time_ms,
          monitor_version,
          version,
          ...cleanMonitor
        } = req.body.ppl_monitor;

        if (Array.isArray(cleanMonitor.triggers)) {
          cleanMonitor.triggers = cleanMonitor.triggers.map(
            ({ id: triggerId, last_triggered_time, last_execution_time, ...trigger }) => trigger
          );
        }

        cleanedBody = { ppl_monitor: cleanMonitor };
      }

      const resp = await client('transport.request', {
        method: 'PUT',
        path: `${PPL_MONITOR_BASE_API}/${encodeURIComponent(id)}${
          qs.toString() ? `?${qs.toString()}` : ''
        }`,
        body: cleanedBody,
        headers: DEFAULT_HEADERS,
      });
      return res.ok({ body: { ok: true, resp } });
    } catch (err) {
      this.logError('Alerting - PplAlertingMonitorService - updateMonitor', err);
      return res.ok({ body: { ok: false, resp: err?.message ?? err } });
    }
  }

  async getMonitor(context, req, res) {
    try {
      const id = req.params.id;
      const client = this.getClientBasedOnDataSource(context, req);

      const raw = await client('transport.request', {
        method: 'GET',
        path: `${PPL_MONITOR_BASE_API}/${encodeURIComponent(id)}`,
        headers: DEFAULT_HEADERS,
      });

      const monitor =
        _.get(raw, 'monitor_v2.ppl_monitor') ||
        _.get(raw, 'monitorV2.ppl_monitor') ||
        _.get(raw, 'ppl_monitor') ||
        _.get(raw, 'monitor') ||
        _.get(raw, '_source') ||
        {};

      const normalized = {
        ...monitor,
        monitor_type: monitor.monitor_type || 'query_level',
        item_type: monitor.workflow_type || monitor.monitor_type || 'query_level',
        id,
        version: _.get(raw, '_version', null),
      };
      normalized.triggers = Array.isArray(normalized.triggers) ? normalized.triggers : [];
      normalized.ui_metadata = normalized.ui_metadata || { triggers: {} };

      return res.ok({
        body: {
          ok: true,
          resp: normalized,
          version: _.get(raw, '_version', null),
          ifSeqNo: _.get(raw, '_seq_no', null),
          ifPrimaryTerm: _.get(raw, '_primary_term', null),
          activeCount: 0,
          dayCount: 0,
        },
      });
    } catch (err) {
      this.logError('Alerting - PplAlertingMonitorService - getMonitor', err);
      return res.ok({ body: { ok: false, resp: err?.message ?? err } });
    }
  }

  async deleteMonitor(context, req, res) {
    try {
      const id = req.params.id;
      const client = this.getClientBasedOnDataSource(context, req);
      const resp = await client('transport.request', {
        method: 'DELETE',
        path: `${PPL_MONITOR_BASE_API}/${encodeURIComponent(id)}`,
        headers: DEFAULT_HEADERS,
      });
      return res.ok({ body: { ok: true, resp } });
    } catch (err) {
      this.logError('Alerting - PplAlertingMonitorService - deleteMonitor', err);
      return res.ok({ body: { ok: false, resp: err?.message ?? err } });
    }
  }

  async executeMonitorById(context, req, res) {
    try {
      const id = req.params.id;
      const client = this.getClientBasedOnDataSource(context, req);
      const resp = await client('transport.request', {
        method: 'POST',
        path: `${PPL_MONITOR_BASE_API}/${encodeURIComponent(id)}/_execute`,
        body: req.body,
        headers: DEFAULT_HEADERS,
      });
      return res.ok({ body: { ok: true, resp } });
    } catch (err) {
      this.logError('Alerting - PplAlertingMonitorService - executeMonitorById', err);
      return res.ok({ body: { ok: false, resp: err?.message ?? err } });
    }
  }

  async executeMonitor(context, req, res) {
    try {
      const client = this.getClientBasedOnDataSource(context, req);
      const resp = await client('transport.request', {
        method: 'POST',
        path: `${PPL_MONITOR_BASE_API}/_execute`,
        body: req.body,
        headers: DEFAULT_HEADERS,
      });
      return res.ok({ body: { ok: true, resp } });
    } catch (err) {
      this.logError('Alerting - PplAlertingMonitorService - executeMonitor', err);
      return res.ok({ body: { ok: false, resp: err?.message ?? err } });
    }
  }

  async alertsForMonitors(context, req, res) {
    try {
      const client = this.getClientBasedOnDataSource(context, req);
      const backendQuery = this.normalizeAlertsQuery(req.query);
      const path = this.buildAlertsPath(backendQuery, { omitDataSourceId: true });

      const resp = await client('transport.request', {
        method: 'GET',
        path,
        headers: DEFAULT_HEADERS,
      });

      return res.ok({ body: { ok: true, resp } });
    } catch (err) {
      if (isIndexNotFoundError(err)) {
        this.logWarn(
          '[Alerting][PPL] Alerts history index not found. Returning empty alerts list.'
        );
        return res.ok({
          body: {
            ok: true,
            resp: { alerts_v2: [], total_alerts_v2: 0 },
          },
        });
      }

      if (isNoHandlerError(err)) {
        this.logWarn('[Alerting][PPL] v2 alerts endpoint not available on target cluster');
        return res.ok({
          body: {
            ok: false,
            resp: 'alerts v2 endpoint not available on the selected data source',
          },
        });
      }

      this.logError('Alerting - PplAlertingMonitorService - alertsForMonitors', err);
      return res.ok({ body: { ok: false, resp: err?.message ?? err } });
    }
  }
}
