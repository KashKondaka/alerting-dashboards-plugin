/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Component, Fragment } from 'react';
import _ from 'lodash';
import { FieldArray, Formik } from 'formik';
import {
  EuiSmallButton,
  EuiSmallButtonEmpty,
  EuiFlexGroup,
  EuiFlexItem,
  EuiSpacer,
  EuiText,
  EuiButtonGroup,
  EuiPanel,
  EuiFormRow,
  EuiTitle,
  EuiButton,
  EuiCodeBlock,
  EuiEmptyPrompt,
  EuiCodeEditor,
  EuiButtonEmpty,
  EuiFieldText,
  EuiTextArea,
  EuiSelect,
  EuiFieldNumber,
  EuiHorizontalRule,
  EuiAccordion,
  EuiSteps,
  EuiTextColor,
  EuiPopover,
  EuiContextMenuPanel,
  EuiContextMenuItem,
  EuiIconTip,
  EuiBadge,
} from '@elastic/eui';

import DefineMonitor from '../DefineMonitor';
import { FORMIK_INITIAL_VALUES } from './utils/constants';
import { formikToMonitor } from './utils/formikToMonitor';
import { MONITOR_TYPE, SEARCH_TYPE } from '../../../../utils/constants';
import { SubmitErrorHandler } from '../../../../utils/SubmitErrorHandler';
import MonitorDetails from '../MonitorDetails';
import ConfigureTriggers from '../../../CreateTrigger/containers/ConfigureTriggers';
import { triggerToFormik } from '../../../CreateTrigger/containers/CreateTrigger/utils/triggerToFormik';
import WorkflowDetails from '../WorkflowDetails/WorkflowDetails';
import {
  getInitialValues,
  getPlugins,
  submit,
  runPPLPreview,
  submitPPL,
} from './utils/helpers';
import {
  getPerformanceModal,
  RECOMMENDED_DURATION,
} from '../../components/QueryPerformance/QueryPerformance';
import { isDataSourceChanged } from '../../../utils/helpers';
import { PageHeader } from '../../../../components/PageHeader/PageHeader';

export default class CreateMonitor extends Component {
  formikRef = React.createRef();

  static defaultProps = {
    edit: false,
    monitorToEdit: null,
    detectorId: null,
    updateMonitor: () => {},
    isDarkMode: false,
  };

  constructor(props) {
    super(props);

    const { location, edit, monitorToEdit } = props;
    const initialValues = {
      monitor_mode: 'legacy',
      ...getInitialValues({ location, monitorToEdit, edit }),
    };

    let triggerToEdit;
    if (edit && monitorToEdit) {
      triggerToEdit = triggerToFormik(_.get(monitorToEdit, 'triggers', []), monitorToEdit);
    }

    this.state = {
      plugins: [],
      response: null,
      performanceResponse: null,
      initialValues,
      triggerToEdit,
      createModalOpen: false,
      formikBag: undefined,
      previewLoading: false,
      previewError: null,
      previewResult: null,
      queryLibOpen: false,
    };
  }

  componentDidMount() {
    const { httpClient } = this.props;

    const updatePlugins = async () => {
      const newPlugins = await getPlugins(httpClient);
      this.setState({ plugins: newPlugins });
    };

    updatePlugins();
    this.setSchedule();
  }

  componentDidUpdate(prevProps) {
    if (isDataSourceChanged(prevProps, this.props)) {
      this.formikRef.current?.setFieldValue(
        'dataSourceId',
        this.props.landingDataSourceId,
        false /* no validate */
      );
    }
  }

  componentWillUnmount() {
    this.props.setFlyout(null);
  }

  resetResponse() {
    this.setState({ response: null, performanceResponse: null });
  }

  onCancel = () => {
    if (this.props.edit) this.props.history.goBack();
    else this.props.history.push('/monitors');
  };

  setSchedule = () => {
    const { edit, monitorToEdit } = this.props;
    const { initialValues } = this.state;

    if (edit) {
      const schedule = _.get(monitorToEdit, 'schedule', FORMIK_INITIAL_VALUES.period);
      const scheduleType = _.keys(schedule)[0];
      switch (scheduleType) {
        case 'cron':
          _.set(initialValues, 'frequency', 'cronExpression');
          break;
        default:
          _.set(initialValues, 'period', schedule.period);
          break;
      }
    }
  };

  evaluateSubmission = (values, formikBag) => {
    const { performanceResponse } = this.props;
    const { createModalOpen } = this.state;
    const monitorDurationCallout = _.get(performanceResponse, 'took') >= RECOMMENDED_DURATION;

    const requestDurationCallout =
      _.get(performanceResponse, 'invalid.path') >= RECOMMENDED_DURATION;
    const displayPerfCallOut = monitorDurationCallout || requestDurationCallout;

    if (!createModalOpen && displayPerfCallOut) {
      this.setState({
        createModalOpen: true,
        formikBag: formikBag,
      });
    } else {
      this.onSubmit(values, formikBag);
    }
  };

  onSubmit = (values, formikBag) => {
    const {
      edit,
      history,
      updateMonitor,
      notifications,
      httpClient,
      monitorToEdit,
      landingDataSourceId,
    } = this.props;
    const { triggerToEdit } = this.state;

    // ppl
    if (values.monitor_mode === 'ppl') {
      submitPPL({
        values,
        formikBag,
        edit,
        monitorToEdit,
        history,
        notifications,
        httpClient,
        dataSourceId: values.dataSourceId || landingDataSourceId,
      });
      return;
    }

    // legacy 
    submit({
      values,
      formikBag,
      edit,
      triggerToEdit,
      history,
      updateMonitor,
      notifications,
      httpClient,
      onSuccess: async ({ monitor }) => {
        notifications.toasts.addSuccess(`Monitor "${monitor.name}" successfully created.`);
      },
    });
  };

  onCloseTrigger = () => {
    this.props.history.push({ ...this.props.location, search: '' });
  };

  buildMonitorForTriggers = (values) => {
    // For PPL mode, hand ConfigureTriggers a legacy-shaped stub it understands.
    if (values.monitor_mode === 'ppl') {
      return {
        name: values.name || '',
        type: 'monitor',
        monitor_type: MONITOR_TYPE.QUERY_LEVEL,
        enabled: true,
        schedule: { period: { interval: 1, unit: 'MINUTES' } },
        inputs: [{ search: { indices: [], query: { match_all: {} } } }],
        ui_metadata: {
          search: { searchType: 'ppl' }, // <- important for trigger UI assumptions
          triggers: {},
        },
        triggers: [], // trigger UI manages values.triggerDefinitions; keep this empty
      };
    }

    // Legacy path stays the same as before
    const monitor = formikToMonitor(values) || {};
    if (!Array.isArray(monitor.inputs) || monitor.inputs.length === 0) {
      monitor.inputs = [{ search: { indices: [], query: { match_all: {} } } }];
      return monitor;
    }
    const first = monitor.inputs[0];
    if (!first.search) first.search = { indices: [], query: { match_all: {} } };
    if (!Array.isArray(first.search.indices)) first.search.indices = [];
    if (!first.search.query) first.search.query = { match_all: {} };
    return monitor;
  };

  renderPplDetailsBody = (values, setFieldValue) => (
    <>
      <EuiFormRow label="Monitor name">
        <EuiFieldText
          data-test-subj="pplName"
          value={values.name}
          onChange={(e) => setFieldValue('name', e.target.value)}
          placeholder="Enter a monitor name"
        />
      </EuiFormRow>
      <EuiFormRow
        label={
          <>
            <span className="euiFormLabel">Description</span>{' '}
            <EuiTextColor color="subdued">
              <span>- optional</span>
            </EuiTextColor>
          </>
        }
      >
        <EuiTextArea
          data-test-subj="pplDescription"
          value={values.description || ''}
          onChange={(e) => setFieldValue('description', e.target.value)}
          placeholder="Describe the monitor"
        />
      </EuiFormRow>
    </>
  );

  renderPplQueryBody = (values, setFieldValue) => (
    <>
      <EuiFlexGroup justifyContent="spaceBetween" alignItems="center" gutterSize="s" responsive={false}>
        <EuiFlexItem grow={false}>
          <EuiFlexGroup alignItems="center" gutterSize="s" responsive={false}>
            <EuiFlexItem grow={false}>
              <EuiBadge
                color="hollow"
                data-test-subj="pplBadge"
                style={{ borderRadius: 8, padding: '2px 10px', fontWeight: 700 }}
              >
                PPL
              </EuiBadge>
            </EuiFlexItem>

            <EuiFlexItem grow={false}>
              <EuiPopover
                isOpen={this.state.queryLibOpen}
                closePopover={() => this.setState({ queryLibOpen: false })}
                panelPaddingSize="s"
                button={
                  <EuiButtonEmpty
                    size="s"
                    onClick={() => this.setState((s) => ({ queryLibOpen: !s.queryLibOpen }))}
                    iconType="arrowDown"
                    iconSide="right"
                    data-test-subj="queryLibraryButton"
                  >
                    Query library
                  </EuiButtonEmpty>
                }
              >
                <EuiContextMenuPanel
                  items={[
                    <EuiContextMenuItem key="saved" onClick={() => this.setState({ queryLibOpen: false })}>
                      Saved queries
                    </EuiContextMenuItem>,
                    <EuiContextMenuItem key="examples" onClick={() => this.setState({ queryLibOpen: false })}>
                      Examples
                    </EuiContextMenuItem>,
                  ]}
                />
              </EuiPopover>
            </EuiFlexItem>
          </EuiFlexGroup>
        </EuiFlexItem>

        <EuiFlexItem grow={false}>
          <EuiFlexGroup alignItems="center" gutterSize="s" responsive={false}>
            <EuiFlexItem grow={false}>
              <EuiButton
                size="s"
                onClick={async () => {
                  const { httpClient, landingDataSourceId } = this.props;
                  this.setState({ previewLoading: true, previewError: null, previewResult: null });
                  try {
                    const data = await runPPLPreview(httpClient, {
                      queryText: values.pplQuery || '',
                      dataSourceId: values.dataSourceId || landingDataSourceId,
                    });
                    this.setState({ previewResult: data, previewLoading: false });
                  } catch (e) {
                    this.setState({
                      previewError: e?.body?.message || e?.message || 'Preview failed',
                      previewLoading: false,
                    });
                  }
                }}
                isLoading={this.state.previewLoading}
                data-test-subj="runPreview"
              >
                Run preview
              </EuiButton>
            </EuiFlexItem>

            <EuiFlexItem grow={false}>
              <EuiIconTip
                type="iInCircle"
                content="Write queries in PPL. Use Query library for saved or example queries."
                position="left"
              />
            </EuiFlexItem>
          </EuiFlexGroup>
        </EuiFlexItem>
      </EuiFlexGroup>

      <EuiSpacer size="s" />

      <EuiCodeEditor
        width="100%"
        height="220px"
        mode="text"
        theme="github"
        value={values.pplQuery}
        onChange={(val) => setFieldValue('pplQuery', val)}
        setOptions={{ showLineNumbers: true, tabSize: 2, useWorker: false }}
        data-test-subj="pplEditor"
        placeholder="// Enter a PPL query"
      />

      <EuiSpacer size="m" />

      <EuiAccordion id="pplPreviewAccordion" buttonContent="Preview results" paddingSize="m" data-test-subj="pplPreviewAccordion">
        <EuiPanel hasBorder paddingSize="l" data-test-subj="pplResultsPanel">
          <EuiTitle size="s"><h2>Results</h2></EuiTitle>
          <EuiHorizontalRule margin="m" />
          {!this.state.previewResult && !this.state.previewError ? (
            <EuiEmptyPrompt iconType="editorCodeBlock" title={<h3>Run a query to view results</h3>} layout="vertical" />
          ) : this.state.previewError ? (
            <EuiCodeBlock isCopyable>{this.state.previewError}</EuiCodeBlock>
          ) : (
            <EuiCodeBlock language="json" isCopyable>
              {JSON.stringify(this.state.previewResult, null, 2)}
            </EuiCodeBlock>
          )}
        </EuiPanel>
      </EuiAccordion>
    </>
  );

  renderPplScheduleBody = (values, setFieldValue) => (
    <>
      <EuiFormRow label="Frequency">
        <EuiSelect
          data-test-subj="pplFrequency"
          options={[
            { value: 'interval', text: 'By interval' },
            { value: 'daily', text: 'Daily' },
            { value: 'weekly', text: 'Weekly' },
            { value: 'monthly', text: 'Monthly' },
            { value: 'cronExpression', text: 'Cron expression' },
          ]}
          value={values.frequency}
          onChange={(e) => setFieldValue('frequency', e.target.value)}
        />
      </EuiFormRow>

      {values.frequency === 'interval' && (
        <EuiFormRow label="Run every">
          <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
            <EuiFlexItem grow={false} style={{ width: 140 }}>
              <EuiFieldNumber
                data-test-subj="pplIntervalValue"
                min={1}
                value={values.period?.interval ?? 1}
                onChange={(e) => setFieldValue('period.interval', Number(e.target.value) || 1)}
              />
            </EuiFlexItem>
            <EuiFlexItem grow={false} style={{ width: 200 }}>
              <EuiSelect
                data-test-subj="pplIntervalUnit"
                options={[
                  { value: 'MINUTES', text: 'minute(s)' },
                  { value: 'HOURS', text: 'hour(s)' },
                  { value: 'DAYS', text: 'day(s)' },
                ]}
                value={values.period?.unit || 'MINUTES'}
                onChange={(e) => setFieldValue('period.unit', e.target.value)}
              />
            </EuiFlexItem>
          </EuiFlexGroup>
        </EuiFormRow>
      )}
    </>
  );

  renderStepPanel = ({ id, title, children, initialIsOpen = true }) => (
    <EuiPanel hasBorder paddingSize="none">
      <EuiAccordion
        id={id}
        initialIsOpen={initialIsOpen}
        paddingSize="m"
        arrowDisplay="left"
        buttonContent={
          <EuiTitle size="s">
            <h2>{title}</h2>
          </EuiTitle>
        }
      >
        {children}
      </EuiAccordion>
    </EuiPanel>
  );

  render() {
    const {
      edit,
      history,
      httpClient,
      location,
      monitorToEdit,
      notifications,
      isDarkMode,
      notificationService,
    } = this.props;
    const { createModalOpen, initialValues, plugins } = this.state;
    return (
      <div style={{ padding: '16px' }}>
        <Formik
          innerRef={this.formikRef}
          initialValues={initialValues}
          onSubmit={this.evaluateSubmission}
          validateOnChange={false}
          enableReinitialize={false}
        >
          {({ values, errors, handleSubmit, isSubmitting, isValid, touched, setFieldValue }) => {
            const isComposite = values.monitor_type === MONITOR_TYPE.COMPOSITE_LEVEL;
            const safeMonitor = this.buildMonitorForTriggers(values);
            const safeTriggers = _.get(safeMonitor, 'triggers', []);
            return (
              <Fragment>
                <PageHeader>
                  <EuiText size="s">
                    <h1>{edit ? 'Edit' : 'Create'} monitor</h1>
                  </EuiText>
                  <EuiSpacer />
                  <EuiFlexGroup justifyContent="flexEnd">
                    <EuiFlexItem grow={false}>
                      <EuiButtonGroup
                        legend="Monitor mode"
                        options={[
                          { id: 'ppl', label: 'Query based PPL monitor' },
                          { id: 'legacy', label: 'Legacy monitor' },
                        ]}
                        type="single"
                        idSelected={values.monitor_mode || 'legacy'}
                        onChange={(id) => setFieldValue('monitor_mode', id)}
                        buttonSize="s"
                      />
                    </EuiFlexItem>
                  </EuiFlexGroup>
                </PageHeader>

                {values.monitor_mode === 'ppl' ? (
                  <div data-test-subj="pplBranch">
                    <EuiSteps
                      firstStepNumber={1}
                      titleSize="xs"
                      steps={[
                        {
                          title: ' ',
                          children: this.renderStepPanel({
                            id: 'pplStep1',
                            title: 'Monitor details',
                            children: this.renderPplDetailsBody(values, setFieldValue),
                          }),
                        },
                        {
                          title: ' ',
                          children: this.renderStepPanel({
                            id: 'pplStep2',
                            title: 'Query',
                            children: this.renderPplQueryBody(values, setFieldValue),
                          }),
                        },
                        {
                          title: ' ',
                          children: this.renderStepPanel({
                            id: 'pplStep3',
                            title: 'Schedule',
                            children: this.renderPplScheduleBody(values, setFieldValue),
                          }),
                        },
                        {
                          title: ' ',
                          children: this.renderStepPanel({
                            id: 'pplStep4',
                            title: 'Triggers',
                            children: (
                              <>
                                <FieldArray name="triggerDefinitions" validateOnChange>
                                  {(triggerArrayHelpers) => (
                                    <ConfigureTriggers
                                      edit={edit}
                                      triggerArrayHelpers={triggerArrayHelpers}
                                      monitor={safeMonitor}
                                      monitorValues={values}
                                      touched={touched}
                                      setFlyout={this.props.setFlyout}
                                      triggers={safeTriggers}
                                      triggerValues={values}
                                      isDarkMode={this.props.isDarkMode}
                                      httpClient={httpClient}
                                      notifications={notifications}
                                      notificationService={notificationService}
                                      plugins={plugins}
                                    />
                                  )}
                                </FieldArray>

                                <EuiSpacer />
                                <EuiFlexGroup alignItems="center" justifyContent="flexEnd">
                                  <EuiFlexItem grow={false}>
                                    <EuiSmallButtonEmpty onClick={this.onCancel}>
                                      Cancel
                                    </EuiSmallButtonEmpty>
                                  </EuiFlexItem>
                                  <EuiFlexItem grow={false}>
                                    <EuiSmallButton fill onClick={handleSubmit} isLoading={isSubmitting}>
                                      {edit ? 'Save' : 'Create'}
                                    </EuiSmallButton>
                                  </EuiFlexItem>
                                </EuiFlexGroup>
                              </>
                            ),
                          }),
                        },
                      ]}
                    />
                  </div>
                ) : (
                  <div data-test-subj="legacyBranch">
                    <MonitorDetails
                      values={values}
                      errors={errors}
                      history={history}
                      httpClient={httpClient}
                      monitorToEdit={monitorToEdit}
                      plugins={plugins}
                      isAd={values.searchType === SEARCH_TYPE.AD}
                      detectorId={this.props.detectorId}
                      setFlyout={this.props.setFlyout}
                    />

                    {isComposite && (
                      <>
                        <EuiSpacer />
                        <WorkflowDetails isDarkMode={isDarkMode} values={values} httpClient={httpClient} errors={errors} />
                      </>
                    )}

                    <EuiSpacer />

                    {values.searchType !== SEARCH_TYPE.AD &&
                      values.monitor_type !== MONITOR_TYPE.COMPOSITE_LEVEL &&
                      !values.preventVisualEditor && (
                        <div>
                          <DefineMonitor
                            values={values}
                            errors={errors}
                            touched={touched}
                            httpClient={httpClient}
                            location={location}
                            detectorId={this.props.detectorId}
                            notifications={notifications}
                            isDarkMode={isDarkMode}
                            landingDataSourceId={this.props.landingDataSourceId}
                          />
                          <EuiSpacer />
                        </div>
                      )}

                    <FieldArray name="triggerDefinitions" validateOnChange>
                      {(triggerArrayHelpers) => (
                        <ConfigureTriggers
                          edit={edit}
                          triggerArrayHelpers={triggerArrayHelpers}
                          monitor={safeMonitor}
                          monitorValues={values}
                          touched={touched}
                          setFlyout={this.props.setFlyout}
                          triggers={safeTriggers}
                          triggerValues={values}
                          isDarkMode={this.props.isDarkMode}
                          httpClient={httpClient}
                          notifications={notifications}
                          notificationService={notificationService}
                          plugins={plugins}
                        />
                      )}
                    </FieldArray>

                    <EuiSpacer />
                    <EuiFlexGroup alignItems="center" justifyContent="flexEnd">
                      <EuiFlexItem grow={false}>
                        <EuiSmallButtonEmpty onClick={this.onCancel}>Cancel</EuiSmallButtonEmpty>
                      </EuiFlexItem>
                      <EuiFlexItem grow={false}>
                        <EuiSmallButton fill onClick={handleSubmit} isLoading={isSubmitting}>
                          {edit ? 'Save' : 'Create'}
                        </EuiSmallButton>
                      </EuiFlexItem>
                    </EuiFlexGroup>
                  </div>
                )}

                <SubmitErrorHandler
                  errors={errors}
                  isSubmitting={isSubmitting}
                  isValid={isValid}
                  onSubmitError={() =>
                    notifications.toasts.addDanger({
                      title: `Failed to ${edit ? 'update' : 'create'} the monitor`,
                      text: 'Fix all highlighted error(s) before continuing.',
                    })
                  }
                />

                {createModalOpen &&
                  getPerformanceModal({
                    edit: edit,
                    onClose: () => {
                      this.state.formikBag.setSubmitting(false);
                      this.setState({ createModalOpen: false, formikBag: undefined });
                    },
                    onSubmit: () => {
                      this.onSubmit(values, this.state.formikBag);
                      this.setState({ createModalOpen: false });
                    },
                    values: values,
                  })}
              </Fragment>
            );
          }}
        </Formik>
      </div>
    );
  }
}
