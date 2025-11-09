/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Component } from 'react';
import PropTypes from 'prop-types';
import _ from 'lodash';
import {
  EuiAccordion,
  EuiButton,
  EuiCallOut,
  EuiSpacer,
  EuiText,
  EuiTitle,
  EuiFlexGroup,
  EuiFlexItem,
  EuiSelect,
  EuiFieldText,
  EuiCheckbox,
  EuiFormRow,
} from '@elastic/eui';
import { Field, FieldArray } from 'formik';
import 'brace/mode/plain_text';

import { FormikFieldText, FormikSelect } from '../../../../components/FormControls';
import { isInvalid, hasError } from '../../../../utils/validate';
import { validateTriggerName } from './utils/validation';
import { OS_NOTIFICATION_PLUGIN, SEVERITY_OPTIONS } from '../../../../utils/constants';
import ConfigureActionsPpl from '../ConfigureActions/ConfigureActionsPpl';
import TriggerGraphPpl from '../../components/TriggerGraphPpl';
import { DEFAULT_TRIGGER_NAME } from '../../utils/constants';
import MinimalAccordion from '../../../../components/FeatureAnywhereContextMenu/MinimalAccordion';
import { getTriggerContext } from '../../utils/helper';

const GRID_MAX = 720;
const GRID_PAD = 10;
const twoColRowStyle = { paddingLeft: GRID_PAD, maxWidth: GRID_MAX };
const twoColRowProps = {
  gutterSize: 'm',
  responsive: false,
  alignItems: 'flexEnd',
  style: twoColRowStyle,
};
const HALF_COL = { flexBasis: '50%', minWidth: 0 };

const defaultRowProps = {
  label: 'Trigger name',
  style: { paddingLeft: '10px' },
  isInvalid,
  error: hasError,
};

const defaultInputProps = { isInvalid };
const selectFieldProps = { validate: () => {} };

const selectRowProps = {
  label: 'Severity level',
  style: { paddingLeft: '10px', marginTop: '0px' },
  isInvalid,
  error: hasError,
};

const TYPE_OPTIONS = [
  { value: 'number_of_results', text: 'Number of results' },
  { value: 'custom', text: 'Custom' },
];

const selectInputProps = { options: SEVERITY_OPTIONS };

const DURATION_OPTIONS = [
  { value: 'minutes', text: 'minute(s)' },
  { value: 'hours', text: 'hour(s)' },
  { value: 'days', text: 'day(s)' },
];

const SUPPRESS_DEFAULT = { value: 10, unit: 'minutes' };
const EXPIRES_DEFAULT = { value: 7, unit: 'days' };

class DefineTriggerPpl extends Component {
  constructor(props) {
    super(props);
    this.state = {
      OuterAccordion: props.flyoutMode ? ({ children }) => <>{children}</> : EuiAccordion,
      currentSubmitCount: 0,
      accordionsOpen: {},
    };
  }

  renderModeSelector(fieldPath) {
    return (
      <Field name={`${fieldPath}mode`}>
        {({ field, form }) => (
          <EuiFormRow label="Trigger mode">
            <EuiSelect
              options={[
                { value: 'result_set', text: 'Once' },
                { value: 'per_result', text: 'For each result' },
              ]}
              value={field.value || 'result_set'}
              onChange={(e) => form.setFieldValue(`${fieldPath}mode`, e.target.value)}
            />
          </EuiFormRow>
        )}
      </Field>
    );
  }

  renderTypeSelector(fieldPath) {
    return (
      <FormikSelect
        name={`${fieldPath}type`}
        formRow
        fieldProps={selectFieldProps}
        rowProps={{ ...selectRowProps, style: { ...selectRowProps.style, paddingLeft: GRID_PAD } }}
        inputProps={{ options: TYPE_OPTIONS }}
      />
    );
  }

  renderSuppressFields(fieldPath) {
    return (
      <EuiFlexGroup {...twoColRowProps}>
        <EuiFlexItem style={HALF_COL}>
          <Field name={`${fieldPath}suppress.value`}>
            {({ field, form }) => (
              <EuiFormRow label="Throttle alerts every">
                <EuiFieldText
                  {...field}
                  onChange={(e) => {
                    const val = Math.max(1, Number(e.target.value || SUPPRESS_DEFAULT.value));
                    form.setFieldValue(`${fieldPath}suppress.value`, val);
                  }}
                  type="number"
                  min={1}
                />
              </EuiFormRow>
            )}
          </Field>
        </EuiFlexItem>
        <EuiFlexItem style={HALF_COL}>
          <Field name={`${fieldPath}suppress.unit`}>
            {({ field, form }) => (
              <EuiFormRow label="Throttle unit">
                <EuiSelect
                  {...field}
                  options={DURATION_OPTIONS}
                  onChange={(e) => form.setFieldValue(`${fieldPath}suppress.unit`, e.target.value)}
                />
              </EuiFormRow>
            )}
          </Field>
        </EuiFlexItem>
      </EuiFlexGroup>
    );
  }

  renderExpiresFields(fieldPath) {
    return (
      <EuiFlexGroup {...twoColRowProps}>
        <EuiFlexItem style={HALF_COL}>
          <Field name={`${fieldPath}expires.value`}>
            {({ field, form }) => (
              <EuiFormRow label="Expire alerts after">
                <EuiFieldText
                  {...field}
                  onChange={(e) => {
                    const val = Math.max(1, Number(e.target.value || EXPIRES_DEFAULT.value));
                    form.setFieldValue(`${fieldPath}expires.value`, val);
                  }}
                  type="number"
                  min={1}
                />
              </EuiFormRow>
            )}
          </Field>
        </EuiFlexItem>
        <EuiFlexItem style={HALF_COL}>
          <Field name={`${fieldPath}expires.unit`}>
            {({ field, form }) => (
              <EuiFormRow label="Expire unit">
                <EuiSelect
                  {...field}
                  options={DURATION_OPTIONS}
                  onChange={(e) => form.setFieldValue(`${fieldPath}expires.unit`, e.target.value)}
                />
              </EuiFormRow>
            )}
          </Field>
        </EuiFlexItem>
      </EuiFlexGroup>
    );
  }

  renderCustomCondition(fieldPath) {
    return (
      <Field name={`${fieldPath}custom_condition`}>
        {({ field, form }) => (
          <EuiFormRow label="Custom painless condition">
            <EuiFieldText
              {...field}
              fullWidth
              onChange={(e) => form.setFieldValue(`${fieldPath}custom_condition`, e.target.value)}
            />
          </EuiFormRow>
        )}
      </Field>
    );
  }

  render() {
    const { OuterAccordion, accordionsOpen, currentSubmitCount } = this.state;
    const {
      edit,
      triggerArrayHelpers,
      monitor,
      monitorValues,
      onRun,
      setFlyout,
      triggers,
      triggerValues,
      isDarkMode,
      triggerIndex,
      httpClient,
      notifications,
      notificationService,
      plugins,
      flyoutMode,
      submitCount,
      errors,
    } = this.props;
    const hasNotificationPlugin = plugins.indexOf(OS_NOTIFICATION_PLUGIN) !== -1;
    const executeResponse = this.props.executeResponse;
    const context = getTriggerContext(executeResponse, monitor, triggerValues, triggerIndex);
    const fieldPath = triggerIndex !== undefined ? `triggerDefinitions[${triggerIndex}].` : '';
    const triggerName = _.get(triggerValues, `${fieldPath}name`, DEFAULT_TRIGGER_NAME);
    const type = _.get(triggerValues, `${fieldPath}type`, 'number_of_results');
    if (flyoutMode && submitCount > currentSubmitCount) {
      accordionsOpen.triggerCondition =
        accordionsOpen?.metrics ||
        (errors.triggerDefinitions?.[triggerIndex] &&
          'name' in errors.triggerDefinitions?.[triggerIndex]);
    }

    return (
      <OuterAccordion
        id={triggerName}
        buttonContent={
          <EuiTitle size={'s'} data-test-subj={`${fieldPath}_triggerAccordion`}>
            <h1>{_.isEmpty(triggerName) ? DEFAULT_TRIGGER_NAME : triggerName}</h1>
          </EuiTitle>
        }
        initialIsOpen={edit ? false : triggerIndex === 0}
        extraAction={
          <EuiButton
            color={'danger'}
            onClick={() => {
              triggerArrayHelpers.remove(triggerIndex);
            }}
            size={'s'}
          >
            Remove trigger
          </EuiButton>
        }
        style={{ paddingBottom: '15px', paddingTop: '10px' }}
      >
        <div style={flyoutMode ? {} : { padding: '0px 20px', paddingTop: '20px' }}>
          <FormikFieldText
            name={`${fieldPath}name`}
            fieldProps={{
              validate: (val) =>
                validateTriggerName(
                  triggerValues?.triggerDefinitions,
                  triggerIndex,
                  flyoutMode
                )(val),
            }}
            formRow
            rowProps={{ ...defaultRowProps, ...(flyoutMode ? { style: {} } : {}) }}
            inputProps={defaultInputProps}
          />
          <EuiSpacer size={'m'} />
          <FormikSelect
            name={`${fieldPath}severity`}
            formRow
            fieldProps={selectFieldProps}
            rowProps={{ ...selectRowProps, ...(flyoutMode ? { style: {} } : {}) }}
            inputProps={selectInputProps}
          />

          <EuiSpacer size="m" />
          {this.renderModeSelector(fieldPath)}
          <EuiSpacer size="m" />
          {this.renderTypeSelector(fieldPath)}

          <EuiSpacer size="m" />

          <TriggerGraphPpl
            monitorValues={monitorValues}
            response={_.get(executeResponse, 'input_results.results[0]')}
            thresholdEnum={_.get(triggerValues, `${fieldPath}num_results_condition`, '>=')}
            thresholdValue={_.get(triggerValues, `${fieldPath}num_results_value`, 1)}
            fieldPath={fieldPath}
            flyoutMode={flyoutMode}
            hideThresholdControls={type !== 'number_of_results'}
            showModeSelector={false}
          />

          {type !== 'number_of_results' && (
            <>
              <EuiSpacer size="m" />
              {this.renderCustomCondition(fieldPath)}
            </>
          )}

          <EuiSpacer size="l" />
          <EuiTitle size="xs">
            <h5>Suppression</h5>
          </EuiTitle>
          <EuiSpacer size="s" />
          {this.renderSuppressFields(fieldPath)}
          <EuiSpacer size="m" />
          <EuiCheckbox
            id={`${fieldPath}throttle_enabled`}
            label="Enable throttling"
            checked={!!_.get(triggerValues, `${fieldPath}throttle_enabled`, true)}
            onChange={(e) =>
              triggerArrayHelpers.form.setFieldValue(
                `${fieldPath}throttle_enabled`,
                e.target.checked
              )
            }
          />

          <EuiSpacer size="l" />
          <EuiTitle size="xs">
            <h5>Expiration</h5>
          </EuiTitle>
          <EuiSpacer size="s" />
          {this.renderExpiresFields(fieldPath)}

          <EuiSpacer size={'l'} />

          <FieldArray name={`${fieldPath}actions`} validateOnChange={true}>
            {(arrayHelpers) => (
              <ConfigureActionsPpl
                arrayHelpers={arrayHelpers}
                context={context}
                httpClient={httpClient}
                setFlyout={setFlyout}
                values={triggerValues}
                notifications={notifications}
                fieldPath={fieldPath}
                triggerIndex={triggerIndex}
                notificationService={notificationService}
                plugins={plugins}
                submitCount={submitCount}
                errors={errors}
                flyoutMode={flyoutMode}
              />
            )}
          </FieldArray>

          {!hasNotificationPlugin && (
            <>
              <EuiSpacer size="m" />
              <EuiCallOut title="The Notifications plugin is not installed" color="warning">
                <p>
                  Alerts still appear on the dashboard visualization when the trigger condition is
                  met.
                </p>
              </EuiCallOut>
            </>
          )}
        </div>
      </OuterAccordion>
    );
  }
}

DefineTriggerPpl.propTypes = {
  executeResponse: PropTypes.object,
  monitorValues: PropTypes.object.isRequired,
  onRun: PropTypes.func.isRequired,
  setFlyout: PropTypes.func.isRequired,
  triggers: PropTypes.arrayOf(PropTypes.object).isRequired,
  triggerValues: PropTypes.object.isRequired,
  isDarkMode: PropTypes.bool.isRequired,
  flyoutMode: PropTypes.string,
  submitCount: PropTypes.number,
  edit: PropTypes.bool,
  triggerArrayHelpers: PropTypes.object,
  monitor: PropTypes.object,
  triggerIndex: PropTypes.number,
  httpClient: PropTypes.object,
  notifications: PropTypes.object,
  notificationService: PropTypes.object,
  plugins: PropTypes.array,
  errors: PropTypes.object,
};

export default DefineTriggerPpl;
