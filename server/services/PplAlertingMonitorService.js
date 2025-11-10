/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import _ from 'lodash';
import querystring from 'querystring';

import { MDSEnabledClientService } from './MDSEnabledClientService';
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
    const { from, size, search, sortField, sortDirection, state, dataSourceId } = query;
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
    if (search) normalized.search = String(search);
    if (sortField) normalized.sortField = String(sortField);
    if (sortDirection) normalized.sortDirection = String(sortDirection);
    if (state) normalized.state = String(state);
    return normalized;
  }

  buildMonitorSearchRequestBody(query = {}) {
    const { from, size, search, sortField, sortDirection, state } = query;

    const parsedFrom = Number.isFinite(from) ? from : Number(from);
    const parsedSize = Number.isFinite(size) ? size : Number(size);

    const body = {
      track_total_hits: true,
      seq_no_primary_term: true,
      version: true,
      from: Number.isFinite(parsedFrom) && parsedFrom >= 0 ? parsedFrom : 0,
      size: Number.isFinite(parsedSize) && parsedSize > 0 ? parsedSize : 20,
      query: { match_all: {} },
    };

    const boolQuery = { must: [], filter: [] };
    const searchText = typeof search === 'string' ? search.trim() : '';
    if (searchText) {
      const escaped = searchText.replace(/([+\-&|!(){}\[\]^"~*?:\\/])/g, '\\$1');
      const wildcardQuery = escaped
        .split(/\s+/)
        .filter(Boolean)
        .map((token) => `*${token}*`)
        .join(' AND ');
      const queryValue = wildcardQuery || `*${escaped}*`;
      boolQuery.must.push({
        query_string: {
          default_field: 'monitor_v2.ppl_monitor.name.keyword',
          default_operator: 'AND',
          query: queryValue,
        },
      });
    }

    const normalizedState = typeof state === 'string' ? state.toLowerCase() : '';
    if (normalizedState && normalizedState !== 'all') {
      const enabled = normalizedState === 'enabled';
      boolQuery.filter.push({
        term: { 'monitor_v2.ppl_monitor.enabled': enabled },
      });
    }

    if (boolQuery.must.length || boolQuery.filter.length) {
      body.query = { bool: {} };
      if (boolQuery.must.length) {
        body.query.bool.must = boolQuery.must;
      }
      if (boolQuery.filter.length) {
        body.query.bool.filter = boolQuery.filter;
      }
    }

    const sortFieldMap = {
      name: 'monitor_v2.ppl_monitor.name.keyword',
      last_update_time: 'monitor_v2.ppl_monitor.last_update_time',
      lastUpdateTime: 'monitor_v2.ppl_monitor.last_update_time',
      state: 'monitor_v2.ppl_monitor.enabled',
    };
    const sortKey = sortFieldMap[sortField] || (sortField ? String(sortField) : null);
    if (sortKey) {
      const direction = typeof sortDirection === 'string' ? sortDirection.toLowerCase() : 'asc';
      body.sort = [
        {
          [sortKey]: {
            order: direction === 'desc' ? 'desc' : 'asc',
            unmapped_type: 'keyword',
          },
        },
      ];
    }

    return body;
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
      const { dataSourceId, ...searchParams } = query;
      const searchBody = this.buildMonitorSearchRequestBody(searchParams);
      const path = `${PPL_MONITOR_BASE_API}/_search`;
      const requestParams = {
        method: 'POST',
        path,
        body: searchBody,
        headers: DEFAULT_HEADERS,
      };
      const resp = await client('transport.request', requestParams);
      return res.ok({ body: { ok: true, ...resp } });
    } catch (err) {
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
      if (!normalized._id) normalized._id = id;
      if (!normalized.id) normalized.id = id;
      const seqNo = _.get(raw, '_seq_no', null);
      const primaryTerm = _.get(raw, '_primary_term', null);
      if (normalized._seq_no === undefined) normalized._seq_no = seqNo;
      if (normalized._primary_term === undefined) normalized._primary_term = primaryTerm;

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
