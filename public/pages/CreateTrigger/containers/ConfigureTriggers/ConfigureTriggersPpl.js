/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { EuiSpacer, EuiSmallButtonIcon } from '@elastic/eui';
import ContentPanel from '../../../../components/ContentPanel';
import _ from 'lodash';
import AddTriggerButtonPpl from '../../components/AddTriggerButton/AddTriggerButtonPpl';
import TriggerEmptyPrompt from '../../components/TriggerEmptyPrompt';
import { MAX_TRIGGERS } from '../../../MonitorDetails/containers/Triggers/Triggers';
import monitorToFormik from '../../../CreateMonitor/containers/CreateMonitor/utils/monitorToFormik';
import { backendErrorNotification, inputLimitText } from '../../../../utils/helpers';
import EnhancedAccordion from '../../../../components/FeatureAnywhereContextMenu/EnhancedAccordion';
import { getDataSourceQueryObj } from '../../../../../public/pages/utils/helpers';
import DefineTriggerPpl from '../DefineTrigger/DefineTriggerPpl';

const build1hSeriesFromTotal = (pplResp, now = Date.now()) => {
  const HOUR_MS = 60 * 60 * 1000;
  const total = Number(pplResp?.total ?? pplResp?.datarows?.length ?? 0) || 0;
  const buckets = [{ key: now - HOUR_MS, doc_count: total }];
  return {
    hits: { total: { value: total, relation: 'eq' } },
    aggregations: {
      ppl_histogram: { buckets },
      count_over_time: { buckets },
      date_histogram: { buckets },
      combined_value: { buckets },
    },
  };
};

class ConfigureTriggersPpl extends React.Component {
  constructor(props) {
    super(props);

    const firstTriggerId = _.get(props.triggerValues, 'triggerDefinitions[0].id');
    const startTriggerIndex = 0;
    const accordionsOpen = firstTriggerId ? { [startTriggerIndex]: true } : {};

    this.state = {
      executeResponse: null,
      previewError: null,
      accordionsOpen,
      TriggerContainer: props.flyoutMode
        ? (p) => <EnhancedAccordion {...p} />
        : ({ children }) => <>{children}</>,
      ContentPanelStructure: props.flyoutMode ? ({ children }) => <>{children}</> : ContentPanel,
    };
  }

  componentDidMount() {
    this.onRunExecute(this.props.monitorValues);
  }

  componentDidUpdate(prevProps) {
    const prevQuery = _.get(prevProps, 'monitorValues.pplQuery');
    const nextQuery = _.get(this.props, 'monitorValues.pplQuery');
    if (prevQuery !== nextQuery) {
      this.onRunExecute(this.props.monitorValues);
    }
  }

  prepareAddTriggerButton = () => {
    const { monitorValues, triggerArrayHelpers, triggerValues } = this.props;
    const disableAddTriggerButton =
      _.get(triggerValues, 'triggerDefinitions', []).length >= MAX_TRIGGERS;
    return (
      <AddTriggerButtonPpl arrayHelpers={triggerArrayHelpers} disabled={disableAddTriggerButton} />
    );
  };

  prepareTriggerEmptyPrompt = () => {
    const { monitorValues, triggerArrayHelpers, flyoutMode } = this.props;
    return (
      <TriggerEmptyPrompt
        arrayHelpers={triggerArrayHelpers}
        monitorType={monitorValues.monitor_type}
        flyoutMode={flyoutMode}
      />
    );
  };

  onRunExecute = (formikValuesArg) => {
    const { httpClient, monitor, notifications } = this.props;
    const formikValues = formikValuesArg || monitorToFormik(monitor);

    const baseQuery = formikValues?.pplQuery || monitor?.ppl_monitor?.query || monitor?.query || '';

    const customCondition =
      typeof formikValuesArg?.customCondition === 'string'
        ? formikValuesArg.customCondition.trim()
        : '';

    let pplQuery = baseQuery;
    if (customCondition) {
      const conditionFragment = customCondition.startsWith('|')
        ? customCondition
        : `| ${customCondition}`;
      pplQuery = `${baseQuery} ${conditionFragment}`.trim();
    }

    let dataSourceQuery = {};
    try {
      dataSourceQuery = getDataSourceQueryObj() || {};
    } catch (err) {
      dataSourceQuery = {};
    }

    httpClient
      .post('/_plugins/_ppl', {
        body: JSON.stringify({ query: pplQuery }),
        query: dataSourceQuery?.query,
      })
      .then((resp) => {
        if (resp.ok) {
          const now = Date.now();
          const normalized = build1hSeriesFromTotal(resp.resp, now);
          const wrapped = {
            ok: true,
            period_start: now - 60 * 60 * 1000,
            period_end: now,
            input_results: { results: [normalized] },
            error: null,
          };
          this.setState({ executeResponse: wrapped, previewError: null });
        } else {
          this.setState({
            executeResponse: null,
            previewError: resp?.resp?.message || 'Incorrect data source or invalid query',
          });
        }
      })
      .catch(() => {
        this.setState({
          executeResponse: null,
          previewError: 'Incorrect data source or invalid query',
        });
      });
  };

  renderDefineTrigger = (triggerArrayHelpers, index) => {
    const {
      edit,
      monitor,
      monitorValues,
      notifications,
      setFlyout,
      triggers,
      triggerValues,
      isDarkMode,
      httpClient,
      notificationService,
      plugins,
      pluginsLoading,
      flyoutMode,
      submitCount,
      errors,
    } = this.props;
    const { executeResponse, previewError } = this.state;
    return (
      <DefineTriggerPpl
        edit={edit}
        triggerArrayHelpers={triggerArrayHelpers}
        executeResponse={executeResponse}
        previewError={previewError}
        monitor={monitor}
        monitorValues={monitorValues}
        onRun={(fv) => this.onRunExecute(fv || monitorValues)}
        setFlyout={setFlyout}
        triggers={triggers}
        triggerValues={triggerValues}
        isDarkMode={isDarkMode}
        triggerIndex={index}
        httpClient={httpClient}
        notifications={notifications}
        notificationService={notificationService}
        plugins={plugins}
        pluginsLoading={pluginsLoading}
        flyoutMode={flyoutMode}
        submitCount={submitCount}
        errors={errors}
      />
    );
  };

  renderTriggers() {
    const { triggerValues, triggerArrayHelpers, flyoutMode } = this.props;
    const { accordionsOpen } = this.state;

    return _.get(triggerValues, 'triggerDefinitions', []).map((trigger, index) => {
      const id = _.get(trigger, 'id', index);
      const TriggerContainer = this.state.TriggerContainer;

      return (
        <TriggerContainer
          key={id}
          id={`${id}`}
          title={trigger.name || `Trigger ${index + 1}`}
          extraActions={
            flyoutMode ? (
              <EuiSmallButtonIcon
                aria-label="Delete trigger"
                iconType="trash"
                color="danger"
                onClick={() => {
                  triggerArrayHelpers.remove(index);
                }}
              />
            ) : undefined
          }
          isOpen={flyoutMode ? accordionsOpen[index] : true}
          onToggle={
            flyoutMode
              ? () =>
                  this.setState({
                    accordionsOpen: { ...accordionsOpen, [index]: !accordionsOpen[index] },
                  })
              : undefined
          }
        >
          {this.renderDefineTrigger(triggerArrayHelpers, index)}
          <EuiSpacer size="m" />
        </TriggerContainer>
      );
    });
  }

  render() {
    const { flyoutMode, triggerValues } = this.props;
    const { ContentPanelStructure } = this.state;
    const numTriggers = _.get(triggerValues, 'triggerDefinitions', []).length;
    const hasTriggers = numTriggers > 0;
    const addTriggerButton = this.prepareAddTriggerButton();
    const triggerEmptyPrompt = this.prepareTriggerEmptyPrompt();
    const headerActions = !flyoutMode ? addTriggerButton : undefined;

    return (
      <ContentPanelStructure
        title={`Triggers (${numTriggers})`}
        titleSize="s"
        bodyStyles={{ padding: 'initial' }}
        actions={headerActions}
      >
        {hasTriggers ? this.renderTriggers() : triggerEmptyPrompt}

        {flyoutMode && (
          <>
            <EuiSpacer size="m" />
            {addTriggerButton}
          </>
        )}

        {!flyoutMode && hasTriggers && (
          <>
            <EuiSpacer size="m" />
            {inputLimitText(numTriggers, MAX_TRIGGERS, 'trigger', 'triggers')}
          </>
        )}
      </ContentPanelStructure>
    );
  }
}

export default ConfigureTriggersPpl;
