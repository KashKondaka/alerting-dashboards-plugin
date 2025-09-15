/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import _ from 'lodash';
import queryString from 'query-string';
import { FORMIK_INITIAL_VALUES } from './constants';
import monitorToFormik from './monitorToFormik';
import { formikToMonitor } from './formikToMonitor';
import { MONITOR_TYPE } from '../../../../../utils/constants';
import { initializeFromQueryParams } from './monitorQueryParams';
import { backendErrorNotification, getDigitId } from '../../../../../utils/helpers';
import {
  formikToTrigger,
  formikToTriggerUiMetadata,
} from '../../../../CreateTrigger/containers/CreateTrigger/utils/formikToTrigger';
import { triggerToFormik } from '../../../../CreateTrigger/containers/CreateTrigger/utils/triggerToFormik';
import { TRIGGER_TYPE } from '../../../../CreateTrigger/containers/CreateTrigger/utils/constants';
import { getInitialTriggerValues } from '../../../../CreateTrigger/components/AddTriggerButton/utils';
import { AGGREGATION_TYPES } from '../../../components/MonitorExpressions/expressions/utils/constants';
import { getDataSourceQueryObj } from '../../../../utils/helpers';

export const getInitialValues = ({
  title,
  index,
  timeField,
  flyoutMode,
  location,
  monitorToEdit,
  edit,
  searchType,
  detectorId,
  embeddable,
}) => {
  let initialValues = _.mergeWith(
    {},
    _.cloneDeep(FORMIK_INITIAL_VALUES),
    initializeFromQueryParams(queryString.parse(location.search)),
    (initialValue, queryValue) => (_.isEmpty(queryValue) ? initialValue : queryValue)
  );

  // allow ?mode=ppl to deep-link into the new flow
  const params = queryString.parse(location.search);
  if (params?.mode === 'ppl') {
    initialValues.monitor_mode = 'ppl';
    initialValues.searchType = 'query'; // not used by ppl, but avoids legacy assumptions
  }

  if (flyoutMode) {
    initialValues.name = `${title} ${getDigitId()}`;
    initialValues.index = index;
    initialValues.timeField = timeField;

    // Add trigger
    const monitorType = initialValues.monitor_type;
    const initialTrigger = getInitialTriggerValues({ flyoutMode, monitorType, triggers: [] });
    initialValues.triggerDefinitions = [initialTrigger];

    // Add aggregations
    initialValues.aggregations = getMetricAgg(embeddable);

    if (searchType) {
      initialValues.searchType = searchType;
    }

    if (detectorId) {
      initialValues.detectorId = detectorId;
      initialValues.period = { interval: 20, unit: 'MINUTES' };
    }
  }

  if (edit && monitorToEdit) {
    const triggers = triggerToFormik(_.get(monitorToEdit, 'triggers', []), monitorToEdit);
    initialValues = {
      ...monitorToFormik(monitorToEdit),
      triggerDefinitions: triggers.triggerDefinitions,
    };
    if (!('monitor_mode' in initialValues)) initialValues.monitor_mode = 'legacy';
  }

  return initialValues;
};

const getMetricAgg = (embeddable) => {
  let aggregationType = AGGREGATION_TYPES[1].value;
  let fieldName = '';
  if (embeddable?.vis?.data?.aggs?.aggs.length === 1) {
    const agg = embeddable.vis.data.aggs.aggs[0];
    if (agg.schema === 'metric' && !(aggregationType && fieldName) && agg.params.field) {
      console.log(agg);
      aggregationType = agg.__type.dslName;
      fieldName = agg.params.field.spec.name;
    }
  }
  return [
    {
      aggregationType: aggregationType,
      fieldName: fieldName,
    },
  ];
};

export const getPlugins = async (httpClient) => {
  try {
    const dataSourceQuery = getDataSourceQueryObj();
    const pluginsResponse = await httpClient.get('../api/alerting/_plugins', dataSourceQuery);
    if (pluginsResponse.ok) {
      return pluginsResponse.resp.map((plugin) => plugin.component);
    } else {
      console.error('There was a problem getting plugins list');
      return [];
    }
  } catch (e) {
    console.error('There was a problem getting plugins list', e);
    return [];
  }
};

export const prepareTriggers = ({
  trigger,
  triggerMetadata,
  monitor,
  edit,
  triggerToEdit = [],
}) => {
  const { ui_metadata: uiMetadata = {}, triggers, monitor_type } = monitor;
  let updatedTriggers;
  let updatedUiMetadata;

  if (edit) {
    updatedTriggers = _.isArray(trigger) ? trigger.concat(triggers) : [trigger].concat(triggers);
    updatedUiMetadata = {
      ...uiMetadata,
      triggers: { ...uiMetadata.triggers, ...triggerMetadata },
    };
  } else {
    const updatedTriggersMetadata = _.cloneDeep(uiMetadata.triggers || {});

    let triggerType;
    switch (monitor_type) {
      case MONITOR_TYPE.BUCKET_LEVEL:
        triggerType = TRIGGER_TYPE.BUCKET_LEVEL;
        break;
      case MONITOR_TYPE.DOC_LEVEL:
        triggerType = TRIGGER_TYPE.DOC_LEVEL;
        break;
      case MONITOR_TYPE.COMPOSITE_LEVEL:
        triggerType = TRIGGER_TYPE.COMPOSITE_LEVEL;
        break;
      default:
        triggerType = TRIGGER_TYPE.QUERY_LEVEL;
        break;
    }

    if (_.isArray(triggerToEdit)) {
      const names = triggerToEdit.map((entry) => _.get(entry, `${triggerType}.name`));
      names.forEach((name) => delete updatedTriggersMetadata[name]);
      updatedTriggers = _.cloneDeep(trigger);
    } else {
      const { name } = _.get(triggerToEdit, `${triggerType}`);
      delete updatedTriggersMetadata[name];

      const findTriggerName = (element) => {
        return name === _.get(element, `${triggerType}.name`);
      };

      const indexToUpdate = _.findIndex(triggers, findTriggerName);
      updatedTriggers = triggers.slice();
      updatedTriggers.splice(indexToUpdate, 1, trigger);
    }

    updatedUiMetadata = {
      ...uiMetadata,
      triggers: { ...updatedTriggersMetadata, ...triggerMetadata },
    };
  }

  return { triggers: updatedTriggers, ui_metadata: updatedUiMetadata };
};

export const create = async ({
  monitor,
  formikBag,
  httpClient,
  notifications,
  history,
  onSuccess,
}) => {
  const { setSubmitting } = formikBag;

  try {
    const isWorkflow = monitor.workflow_type === MONITOR_TYPE.COMPOSITE_LEVEL;
    const creationPool = isWorkflow ? 'workflows' : 'monitors';
    const dataSourceQuery = getDataSourceQueryObj();
    const resp = await httpClient.post(`../api/alerting/${creationPool}`, {
      body: JSON.stringify(monitor),
      query: dataSourceQuery?.query,
    });
    setSubmitting(false);
    const {
      ok,
      resp: { _id },
    } = resp;
    if (ok) {
      history.push(`/monitors/${_id}?type=${isWorkflow ? 'workflow' : 'monitor'}`);

      if (onSuccess) {
        onSuccess({ monitor: { _id, ...monitor } });
      }
    } else {
      console.log('Failed to create:', resp);
      backendErrorNotification(notifications, 'create', 'monitor', resp.resp);
    }
  } catch (err) {
    console.error(err);
    setSubmitting(false);
  }
};

export const update = async ({ history, updateMonitor, notifications, monitor, formikBag }) => {
  const { setSubmitting } = formikBag;
  const updatedMonitor = _.cloneDeep(monitor);
  try {
    const isWorkflow = updatedMonitor.workflow_type === MONITOR_TYPE.COMPOSITE_LEVEL;
    const resp = await updateMonitor(updatedMonitor);
    setSubmitting(false);
    const { ok, id } = resp;
    if (ok) {
      notifications.toasts.addSuccess(`Monitor "${monitor.name}" successfully updated.`);
      history.push(`/monitors/${id}?type=${isWorkflow ? 'workflow' : 'monitor'}`);
    } else {
      console.log('Failed to update:', resp);
    }
  } catch (err) {
    console.error(err);
    setSubmitting(false);
  }
};

export const submit = ({
  values,
  formikBag,
  edit,
  triggerToEdit,
  history,
  updateMonitor,
  notifications,
  httpClient,
  onSuccess,
}) => {
  let monitor = formikToMonitor(values);

  if (!_.isEmpty(_.get(values, 'triggerDefinitions'))) {
    const monitorUiMetadata = _.get(monitor, 'ui_metadata', {});
    const triggerMetadata = formikToTriggerUiMetadata(values, monitorUiMetadata);
    const triggers = prepareTriggers({
      trigger: formikToTrigger(values, monitorUiMetadata),
      triggerMetadata,
      monitor,
      edit,
      triggerToEdit,
    });
    monitor = { ...monitor, ...triggers };
  }

  if (edit) {
    update({ history, updateMonitor, notifications, monitor, formikBag });
  } else {
    create({ history, monitor, formikBag, httpClient, notifications, onSuccess });
  }
};

/** ----------------------------------------------------------------
 * New helpers (Alerting V2 / PPL)
 * ---------------------------------------------------------------*/

/**
 * Small service wrapper that calls the server (proxy) API for V2 routes.
 */
export const makeAlertingV2Service = (httpClient) => {
  const base = '../api/alerting/v2';

  const withDataSource = () => {
    const ds = getDataSourceQueryObj();
    return ds?.query || {};
  };

  return {
    /** Create a PPL MonitorV2 */
    createMonitor: async (body, { dataSourceId } = {}) => {
      const query = withDataSource();
      if (dataSourceId) query['dataSourceId'] = dataSourceId;
      console.log("createmonitor body:", JSON.stringify(body));
      return httpClient.post(`${base}/monitors`, {
        body: JSON.stringify(body),
        query,
      }).then((r) => {
        if (!r.ok) throw r.resp || r;
        return r.resp;
      });
    },

    /** Update an existing PPL MonitorV2 */
    updateMonitor: async (id, body, { ifSeqNo, ifPrimaryTerm, dataSourceId } = {}) => {
      const query = withDataSource();
      if (dataSourceId) query['dataSourceId'] = dataSourceId;
      if (Number.isFinite(ifSeqNo)) query['if_seq_no'] = ifSeqNo;
      if (Number.isFinite(ifPrimaryTerm)) query['if_primary_term'] = ifPrimaryTerm;
      return httpClient.put(`${base}/monitors/${encodeURIComponent(id)}`, {
        body: JSON.stringify(body),
        query,
      }).then((r) => {
        if (!r.ok) throw r.resp || r;
        return r.resp;
      });
    },

    /** Run a lightweight PPL preview (query-only) */
    previewPPL: async (queryText, { dataSourceId } = {}) => {
      const query = withDataSource();
      if (dataSourceId) query['dataSourceId'] = dataSourceId;
      return httpClient.post(`${base}/preview`, {
        body: JSON.stringify({ query: queryText }),
        query,
      }).then((r) => {
        if (!r.ok) throw r.resp || r;
        return r.resp;
      });
    },
  };
};

/** Map Formik values -> V2 schedule (Interval or Cron) */
export const pplToV2Schedule = (values) => {
  if (values.frequency === 'interval') {
    return {
      period: {
        interval: Number(values.period?.interval || 1),
        unit: values.period?.unit || 'MINUTES',
      },
    };
  }
  if (values.frequency === 'cronExpression' && values.cronExpression) {
    return {
      cron: {
        expression: values.cronExpression,
        timezone: values.timezone || 'UTC',
      },
    };
  }
  // fallback
  return {
    period: {
      interval: 1,
      unit: 'MINUTES',
    },
  };
};

/** Convert a triggerDefinition from Formik -> ppl_trigger payload */
const formikPplTriggerToWire = (t, i = 0) => {
  const normalizeSeverity = (s) => {
    const v = String(s ?? '').toLowerCase();
    if (['info', 'low', 'medium', 'high', 'critical', 'error'].includes(v)) return v;
    if (v === '0') return 'info';
    if (v === '1') return 'low';
    if (v === '2') return 'medium';
    if (v === '3') return 'high';
    if (v === '4') return 'critical';
    return 'info';
  };

  const type = (t?.conditionType || t?.type || 'number_of_results');
  const isNum = type === 'number_of_results';

  return {
    name: t?.name || `trigger${i + 1}`,
    severity: normalizeSeverity(t?.severity),
    actions: t?.actions || [],
    mode: t?.mode || 'result_set',                   // 'result_set' | 'per_result'
    type,                                            // 'number_of_results' | 'custom'
    num_results_condition: isNum ? (t?.numResultsOp || t?.operator || '>=') : null,
    num_results_value: isNum ? Number(t?.numResultsValue ?? t?.value ?? 1) : null,
    custom_condition: !isNum ? (t?.customCondition || null) : null,
    suppress: t?.suppress ?? null,
    expires: t?.expires || '7d',
    last_triggered_time: null,
  };
};

/**
 * Build the MonitorV2 (PPL) payload expected by backend.
 * Shape: { "monitor_v2": { "ppl_monitor": { ... } } }
 */
export const buildPPLMonitorFromFormik = (values) => {
  const defs = Array.isArray(values.triggerDefinitions) ? values.triggerDefinitions : [];
  const triggers = defs.length
    ? defs.map(formikPplTriggerToWire)
    : [{
        name: 'trigger1',
        severity: 'info',
        actions: [],
        mode: 'result_set',
        type: 'number_of_results',
        num_results_condition: '>=',
        num_results_value: 1,
        custom_condition: null,
        suppress: null,
        expires: '7d',
        last_triggered_time: null,
      }];

  return {
    ppl_monitor: {
      name: values.name || 'Untitled monitor',
      enabled: !values.disabled,
      schedule: pplToV2Schedule(values),
      look_back_window: values.frequency === 'cronExpression'
        ? (values.lookBackWindow || null)
        : null,
      triggers,
      schema_version: 0,
      query_language: 'ppl',
      query: values.pplQuery || '',
    },
  };
};

/** Convenience: run preview via service */
export const runPPLPreview = async (httpClient, { queryText, dataSourceId }) => {
  const api = makeAlertingV2Service(httpClient);
  return api.previewPPL(queryText, { dataSourceId });
};

/** Create or update a PPL MonitorV2 */
export const submitPPL = async ({
  values,
  formikBag,
  edit,
  monitorToEdit,
  history,
  notifications,
  httpClient,
  dataSourceId,
}) => {
  const { setSubmitting } = formikBag;
  const api = makeAlertingV2Service(httpClient);
  const body = buildPPLMonitorFromFormik(values);

  try {
    if (edit && monitorToEdit?._id) {
      const seqNo = monitorToEdit?._seq_no;
      const primary = monitorToEdit?._primary_term;
      await api.updateMonitor(monitorToEdit._id, body, {
        ifSeqNo: seqNo,
        ifPrimaryTerm: primary,
        dataSourceId,
      });
      notifications.toasts.addSuccess(`Monitor "${values.name}" saved.`);
      history.push(`/monitors/${monitorToEdit._id}`);
    } else {
      console.log("body:", body);
      const res = await api.createMonitor(body, { dataSourceId });
      notifications.toasts.addSuccess(`Monitor "${values.name}" successfully created.`);
      history.push(`/monitors/${res._id || res.id || ''}`);
    }
  } catch (e) {
    notifications.toasts.addDanger(
      e?.message || e?.body?.message || `Failed to ${edit ? 'update' : 'create'} the monitor`
    );
  } finally {
    setSubmitting(false);
  }
};

// export const submitPPL = async ({
//   values,
//   formikBag,
//   edit,
//   monitorToEdit,
//   history,
//   notifications,
//   httpClient,
//   dataSourceId,
// }) => {
//   const { setSubmitting } = formikBag;
//   const api = makeAlertingV2Service(httpClient);

//   const body = {};  // <<<<<<<<<<<<<<<<<<<<<

//   try {
//     if (edit && monitorToEdit?._id) {
//       await api.updateMonitor(monitorToEdit._id, body, {
//         ifSeqNo: monitorToEdit?._seq_no,
//         ifPrimaryTerm: monitorToEdit?._primary_term,
//         dataSourceId,
//       });
//       notifications.toasts.addSuccess(`Monitor "${values.name}" saved.`);
//       history.push(`/monitors/${monitorToEdit._id}`);
//     } else {
//       const res = await api.createMonitor(body, { dataSourceId });
//       notifications.toasts.addSuccess(`Monitor "${values.name}" successfully created.`);
//       history.push(`/monitors/${res._id || res.id || ''}`);
//     }
//   } catch (e) {
//     notifications.toasts.addDanger(e?.message || e?.body?.message || 'Failed to create the monitor');
//   } finally {
//     setSubmitting(false);
//   }
// };
