/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  EuiHorizontalRule,
  EuiSpacer,
  EuiBadge,
  EuiFlexGroup,
  EuiFlexItem,
  EuiSmallButtonIcon,
} from '@elastic/eui';
import ContentPanel from '../../../../components/ContentPanel';
import _ from 'lodash';
import AddTriggerButton from '../../components/AddTriggerButton';
import TriggerEmptyPrompt from '../../components/TriggerEmptyPrompt';
import { MAX_TRIGGERS } from '../../../MonitorDetails/containers/Triggers/Triggers';
import { MONITOR_TYPE } from '../../../../utils/constants';
import monitorToFormik from '../../../CreateMonitor/containers/CreateMonitor/utils/monitorToFormik';
import { backendErrorNotification, inputLimitText } from '../../../../utils/helpers';
import EnhancedAccordion from '../../../../components/FeatureAnywhereContextMenu/EnhancedAccordion';
import { getDataSourceQueryObj } from '../../../../../public/pages/utils/helpers';
import DefineTriggerPpl from '../DefineTrigger/DefineTriggerPpl';

class ConfigureTriggersPpl extends React.Component {
  constructor(props) {
    super(props);

    const firstTriggerId = _.get(props.triggerValues, 'triggerDefinitions[0].id');
    const startTriggerIndex = 0;
    const accordionsOpen = firstTriggerId ? { [startTriggerIndex]: true } : {};

    this.state = {
      executeResponse: null,
      triggerDeleted: false,
      addTriggerButton: this.prepareAddTriggerButton(),
      triggerEmptyPrompt: this.prepareTriggerEmptyPrompt(),
      currentSubmitCount: 0,
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
    if (!_.isEqual(prevProps.monitorValues, this.props.monitorValues)) {
      this.setState({ addTriggerButton: this.prepareAddTriggerButton() });
      this.setState({ triggerEmptyPrompt: this.prepareTriggerEmptyPrompt() });
    }
  }

  prepareAddTriggerButton = () => {
    const { monitorValues, triggerArrayHelpers, triggerValues } = this.props;
    const disableAddTriggerButton =
      _.get(triggerValues, 'triggerDefinitions', []).length >= MAX_TRIGGERS;
    return (
      <AddTriggerButton
        arrayHelpers={triggerArrayHelpers}
        disabled={disableAddTriggerButton}
        monitorType={monitorValues.monitor_type}
      />
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

  onRunExecute = (formikValuesArg, triggers = []) => {
    const { httpClient, monitor, notifications } = this.props;
    const formikValues = formikValuesArg || monitorToFormik(monitor);

    const isPpl =
      monitor?.query_language === 'ppl' ||
      formikValues?.monitor_mode === 'ppl' ||
      !!monitor?.ppl_monitor ||
      !!formikValues?.pplQuery;

    if (!isPpl) {
      this.setState({ executeResponse: null });
      return;
    }

    const pplQuery = formikValues?.pplQuery || monitor?.ppl_monitor?.query || monitor?.query || '';

    const dataSourceQuery = getDataSourceQueryObj();
    httpClient
      .post('/_plugins/_ppl', {
        body: JSON.stringify({ query: pplQuery }),
        query: dataSourceQuery?.query,
      })
      .then((resp) => {
        if (resp.ok) {
          const now = Date.now();
          const wrapped = {
            ok: true,
            period_start: now - 60 * 60 * 1000,
            period_end: now,
            input_results: { results: [resp.resp] },
            error: null,
          };
          this.setState({ executeResponse: wrapped });
        } else {
          backendErrorNotification(notifications, 'preview', 'query', resp.resp);
        }
      })
      .catch((err) => {
        console.error('err:', err);
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
    const { executeResponse } = this.state;
    return (
      <DefineTriggerPpl
        edit={edit}
        triggerArrayHelpers={triggerArrayHelpers}
        executeResponse={executeResponse}
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
    const {
      triggerValues,
      triggerArrayHelpers,
      triggerDefinitionsErrors = [],
      flyoutMode,
    } = this.props;
    const { accordionsOpen, currentSubmitCount } = this.state;
    return _.get(triggerValues, 'triggerDefinitions', []).map((trigger, index) => {
      const id = _.get(trigger, 'id', index);
      const TriggerContainer = this.state.TriggerContainer;
      const triggerErrors = triggerDefinitionsErrors[index] || {};
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
                  this.setState({ triggerDeleted: true });
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
                    currentSubmitCount: this.props.submitCount,
                  })
              : undefined
          }
        >
          {this.renderDefineTrigger(triggerArrayHelpers, index, triggerErrors, currentSubmitCount)}
          <EuiSpacer size="m" />
        </TriggerContainer>
      );
    });
  }

  render() {
    const { flyoutMode, triggerArrayHelpers, triggerValues, submitCount } = this.props;
    const { ContentPanelStructure, addTriggerButton, triggerEmptyPrompt } = this.state;
    const numTriggers = _.get(triggerValues, 'triggerDefinitions', []).length;
    const hasTriggers = numTriggers > 0;

    return (
      <ContentPanelStructure
        title={`Triggers (${numTriggers})`}
        titleSize="s"
        bodyStyles={{ padding: 'initial' }}
      >
        {!flyoutMode && <EuiHorizontalRule margin="s" />}
        {hasTriggers ? (
          <>
            <EuiFlexGroup justifyContent="flexStart" gutterSize="s" responsive={false}>
              <EuiFlexItem grow={false}>
                <EuiBadge>{`${numTriggers} triggers`}</EuiBadge>
              </EuiFlexItem>
              <EuiFlexItem grow={false}>{addTriggerButton}</EuiFlexItem>
            </EuiFlexGroup>
            <EuiSpacer size="m" />
            {this.renderTriggers()}
          </>
        ) : (
          triggerEmptyPrompt
        )}
        {flyoutMode && <EuiSpacer size="m" />}
        {flyoutMode && hasTriggers && addTriggerButton}
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
